import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as github from "@actions/github";

import { loadConfig, mergeConfig, validateConfig, MergedConfig } from "./config.js";
import { loadBaseline, saveBaseline, compareToBaseline, ScoreComparison } from "./baseline.js";
import { registerInputSecrets } from "./secrets.js";
import {
  formatComment,
  postComment,
  updateComment,
  findExistingComment,
  AuditResult,
  AuditIssue,
} from "./comment.js";

interface CliResult {
  job_id?: string;
  status?: string;
  url?: string;
  mode?: string;
  scores?: Record<string, number>;
  issues?: AuditIssue[] | Record<string, AuditIssue[]>;
  error?: string;
}

/**
 * Normalize issues from various formats to array
 */
function normalizeIssues(issues: CliResult["issues"]): AuditIssue[] {
  if (Array.isArray(issues)) {
    return issues;
  }
  if (issues && typeof issues === "object") {
    const values = Object.values(issues);
    return values.flatMap((value) => (Array.isArray(value) ? value : []));
  }
  return [];
}

/**
 * Calculate overall score from individual scores
 */
function calculateOverallScore(scores: Record<string, number>): number | null {
  if (!scores || Object.keys(scores).length === 0) {
    return null;
  }
  // If there's an explicit overall score, use it
  if (typeof scores.overall === "number") {
    return scores.overall;
  }
  if (typeof scores.ux === "number") {
    return scores.ux;
  }
  // Calculate average of all numeric scores
  const numericScores = Object.values(scores).filter(
    (v): v is number => typeof v === "number" && Number.isFinite(v)
  );
  if (numericScores.length === 0) {
    return null;
  }
  return Math.round(
    numericScores.reduce((sum, v) => sum + v, 0) / numericScores.length
  );
}

/**
 * Count issues by severity
 */
function countIssuesBySeverity(issues: AuditIssue[]): {
  total: number;
  critical: number;
} {
  const critical = issues.filter(
    (issue) => issue.severity?.toLowerCase() === "critical"
  ).length;
  return {
    total: issues.length,
    critical,
  };
}

/**
 * Execute CLI and capture JSON output
 */
async function executeCli(
  url: string,
  mode: string,
  timeout: number,
  apiKey: string
): Promise<CliResult> {
  let stdout = "";
  let stderr = "";

  const args = ["@vertaaux/cli", "audit", url, "--mode", mode, "--wait", "--format", "json"];

  // Add timeout in seconds (CLI uses ms internally but we pass the value)
  if (timeout > 0) {
    args.push("--timeout", timeout.toString());
  }

  core.info(`Running: npx ${args.join(" ")}`);

  try {
    await exec.exec("npx", args, {
      env: {
        ...process.env,
        VERTAAUX_API_KEY: apiKey,
      },
      listeners: {
        stdout: (data: Buffer) => {
          stdout += data.toString();
        },
        stderr: (data: Buffer) => {
          stderr += data.toString();
        },
      },
      silent: false,
    });
  } catch (error) {
    // CLI might have exited with non-zero due to threshold, check if we got JSON
    core.debug(`CLI stderr: ${stderr}`);
    if (!stdout.trim()) {
      throw new Error(`CLI execution failed: ${stderr || error}`);
    }
  }

  // Parse JSON output
  try {
    // Find JSON in output (might have other text around it)
    const jsonMatch = stdout.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("No JSON found in CLI output");
    }
    return JSON.parse(jsonMatch[0]) as CliResult;
  } catch (parseError) {
    core.error(`Failed to parse CLI output as JSON`);
    core.debug(`stdout: ${stdout}`);
    throw new Error(`Failed to parse audit result: ${parseError}`);
  }
}

/**
 * Check thresholds and determine if check should fail
 */
function checkThresholds(
  scores: Record<string, number>,
  config: MergedConfig,
  criticalCount: number,
  comparison: ScoreComparison | null
): { pass: boolean; failures: string[]; warnings: string[] } {
  const failures: string[] = [];
  const warnings: string[] = [];

  // Check overall threshold
  if (config.thresholds.overall !== undefined) {
    const overall = calculateOverallScore(scores);
    if (overall !== null && overall < config.thresholds.overall) {
      failures.push(
        `Overall score ${overall} is below threshold ${config.thresholds.overall}`
      );
    }
  }

  // Check category thresholds
  if (config.thresholds.usability !== undefined) {
    const score = scores.usability ?? scores.ux;
    if (typeof score === "number" && score < config.thresholds.usability) {
      failures.push(
        `Usability score ${score} is below threshold ${config.thresholds.usability}`
      );
    }
  }

  if (config.thresholds.clarity !== undefined) {
    const score = scores.clarity;
    if (typeof score === "number" && score < config.thresholds.clarity) {
      failures.push(
        `Clarity score ${score} is below threshold ${config.thresholds.clarity}`
      );
    }
  }

  if (config.thresholds.accessibility !== undefined) {
    const score = scores.accessibility;
    if (typeof score === "number" && score < config.thresholds.accessibility) {
      failures.push(
        `Accessibility score ${score} is below threshold ${config.thresholds.accessibility}`
      );
    }
  }

  // Check critical issues
  if (config.failOnCritical && criticalCount > 0) {
    failures.push(`Found ${criticalCount} critical issue(s)`);
  }

  // Check regression
  if (comparison?.hasRegression) {
    const message = "Score regression detected compared to baseline";
    if (config.failOnRegression) {
      failures.push(message);
    } else {
      warnings.push(message);
    }
  }

  return {
    pass: failures.length === 0,
    failures,
    warnings,
  };
}

/**
 * Check if running in a pull request context
 */
function isPullRequest(): boolean {
  return (
    github.context.eventName === "pull_request" ||
    github.context.eventName === "pull_request_target"
  );
}

/**
 * Check if running on main/master branch
 */
function isMainBranch(): boolean {
  const ref = github.context.ref;
  return ref === "refs/heads/main" || ref === "refs/heads/master";
}

/**
 * Main action entrypoint
 */
async function run(): Promise<void> {
  try {
    // Read inputs
    const url = core.getInput("url", { required: true });
    const apiKey = core.getInput("api-key", { required: true });
    const githubToken = core.getInput("github-token");

    // Register sensitive inputs with the runner so they are masked in
    // workflow logs (CWE-532). GitHub auto-masks values passed via
    // ${{ secrets.X }}, but registering here is defense in depth: it
    // covers the case where a workflow author passes a literal token
    // or pulls one from a non-secret source, and the github-token
    // default `${{ github.token }}` which the runner already protects
    // but re-registering is harmless.
    registerInputSecrets(apiKey, githubToken);

    const modeInput = core.getInput("mode") || "";
    const waitInput = core.getInput("wait") || "true";
    const timeoutInput = core.getInput("timeout") || "120000";
    const thresholdInput = core.getInput("threshold") || "";
    const thresholdsInput = core.getInput("thresholds") || "";
    const failOnCriticalInput = core.getInput("fail-on-critical") || "";
    const failOnRegressionInput = core.getInput("fail-on-regression") || "";
    const commentOnPrInput = core.getInput("comment-on-pr") || "";
    const updateBaselineInput = core.getInput("update-baseline") || "";
    const baselineFileInput = core.getInput("baseline-file") || "";
    const configFileInput = core.getInput("config-file") || "";

    // Load config file and merge with inputs
    const fileConfig = loadConfig(configFileInput);
    const config = mergeConfig(fileConfig, {
      threshold: thresholdInput,
      thresholds: thresholdsInput,
      failOnCritical: failOnCriticalInput,
      failOnRegression: failOnRegressionInput,
      commentOnPr: commentOnPrInput,
      updateBaseline: updateBaselineInput,
      baselineFile: baselineFileInput,
      configFile: configFileInput,
      mode: modeInput,
    });

    // Validate config
    const configErrors = validateConfig(config);
    if (configErrors.length > 0) {
      throw new Error(`Invalid configuration: ${configErrors.join("; ")}`);
    }

    const timeout = parseInt(timeoutInput, 10) || 120000;
    const wait = waitInput !== "false";

    core.info(`Auditing URL: ${url}`);
    core.info(`Mode: ${config.mode}`);
    core.info(`Wait: ${wait}`);
    core.info(`Timeout: ${timeout}ms`);

    if (!wait) {
      core.warning(
        "wait=false is not recommended for CI - results may not be available"
      );
    }

    // Execute CLI
    const cliResult = await executeCli(url, config.mode, timeout, apiKey);

    if (cliResult.error) {
      throw new Error(`Audit failed: ${cliResult.error}`);
    }

    if (cliResult.status === "failed") {
      throw new Error(`Audit failed: ${cliResult.error || "Unknown error"}`);
    }

    // Extract data from result
    const scores = cliResult.scores || {};
    const issues = normalizeIssues(cliResult.issues);
    const { total: issuesCount, critical: criticalCount } =
      countIssuesBySeverity(issues);
    const overallScore = calculateOverallScore(scores);
    const jobId = cliResult.job_id || "";
    const reportUrl = `https://vertaaux.ai/reports/${jobId}`;

    // Load baseline and compare
    const baseline = loadBaseline(config.baselineFile);
    const comparison = compareToBaseline(
      baseline,
      url,
      {
        overall: overallScore ?? undefined,
        usability: scores.usability ?? scores.ux,
        accessibility: scores.accessibility,
        clarity: scores.clarity,
      },
      config.regressionThreshold
    );

    // Set outputs
    core.setOutput("job-id", jobId);
    core.setOutput("overall-score", overallScore?.toString() || "");
    core.setOutput("usability-score", (scores.usability ?? scores.ux ?? "").toString());
    core.setOutput("clarity-score", (scores.clarity ?? "").toString());
    core.setOutput("accessibility-score", (scores.accessibility ?? "").toString());
    core.setOutput("issues-count", issuesCount.toString());
    core.setOutput("critical-count", criticalCount.toString());
    core.setOutput("report-url", reportUrl);
    core.setOutput("result-json", JSON.stringify(cliResult));
    core.setOutput("regression-detected", comparison.hasRegression.toString());
    core.setOutput("baseline-comparison", JSON.stringify(comparison));

    // Log summary
    core.info("--- Audit Results ---");
    core.info(`Job ID: ${jobId}`);
    core.info(`Overall Score: ${overallScore ?? "N/A"}`);
    core.info(`Issues: ${issuesCount} (${criticalCount} critical)`);
    core.info(`Report: ${reportUrl}`);

    if (comparison.isNewPage) {
      core.info("New page - no baseline comparison available");
    } else if (comparison.hasRegression) {
      core.warning("Regression detected compared to baseline");
    }

    // Post PR comment (if in PR context and enabled)
    if (isPullRequest() && config.commentOnPr && githubToken) {
      core.info("Posting PR comment...");

      const auditResult: AuditResult = {
        url,
        mode: config.mode,
        jobId,
        scores: {
          overall: overallScore ?? undefined,
          usability: scores.usability ?? scores.ux,
          accessibility: scores.accessibility,
          clarity: scores.clarity,
        },
        issues,
        reportUrl,
      };

      const commentBody = formatComment(
        auditResult,
        comparison,
        {
          thresholds: config.thresholds,
          failOnCritical: config.failOnCritical,
          failOnRegression: config.failOnRegression,
          regressionThreshold: config.regressionThreshold,
        }
      );

      try {
        const octokit = github.getOctokit(githubToken);
        const existingId = await findExistingComment(octokit, github.context);

        if (existingId && config.updateExistingComment) {
          await updateComment(octokit, github.context, existingId, commentBody);
          core.info(`Updated existing PR comment (id: ${existingId})`);
        } else {
          const commentId = await postComment(octokit, github.context, commentBody);
          core.info(`Posted new PR comment (id: ${commentId})`);
        }
      } catch (commentError) {
        // Don't fail the action if comment fails
        core.warning(`Failed to post PR comment: ${commentError}`);
      }
    } else if (isPullRequest() && config.commentOnPr && !githubToken) {
      core.warning(
        "PR comment enabled but no github-token provided. Skipping comment."
      );
    }

    // Update baseline (typically on main branch)
    const shouldUpdateBaseline =
      updateBaselineInput === "true" ||
      (config.updateBaselineOnMain && isMainBranch());

    if (shouldUpdateBaseline) {
      core.info("Updating baseline file...");
      try {
        saveBaseline(
          config.baselineFile,
          url,
          {
            overall: overallScore ?? undefined,
            usability: scores.usability ?? scores.ux,
            accessibility: scores.accessibility,
            clarity: scores.clarity,
          },
          issuesCount
        );
        core.info(
          "Baseline updated - commit the changes to persist"
        );
      } catch (baselineError) {
        core.warning(`Failed to update baseline: ${baselineError}`);
      }
    }

    // Check thresholds
    const thresholdCheck = checkThresholds(
      scores,
      config,
      criticalCount,
      comparison
    );

    // Log warnings
    for (const warning of thresholdCheck.warnings) {
      core.warning(warning);
    }

    if (!thresholdCheck.pass) {
      const message = thresholdCheck.failures.join("; ");
      core.setFailed(`Audit failed threshold checks: ${message}`);
      return;
    }

    core.info("All threshold checks passed");
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error.message);
    } else {
      core.setFailed(`An unexpected error occurred: ${error}`);
    }
  }
}

run();
