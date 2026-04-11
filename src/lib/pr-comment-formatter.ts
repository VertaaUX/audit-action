/**
 * PR comment formatter (Phase 112 / ECO-04).
 *
 * Pure function that converts an audit (+ optional baseline comparison +
 * optional policy config) into a GitHub PR-comment markdown artifact. Shared
 * by the GitHub Action (`action/src/comment.ts`) and the MCP tool
 * (`mcp-server/src/tools/format-pr-comment.ts`).
 *
 * Mirrored into mcp-server/src/lib/ and action/src/lib/ because both packages
 * use `rootDir=./src` and cannot import from this file directly (same pattern
 * as lib/audit-delta.ts). Manual sync required.
 *
 * Output format is byte-stable — do NOT tweak whitespace, header text, or
 * marker strings without regenerating the golden fixture in
 * `__tests__/lib/pr-comment-formatter.golden.md`.
 */

export interface PrCommentScores {
  overall?: number;
  usability?: number;
  ux?: number;
  accessibility?: number;
  clarity?: number;
  [key: string]: number | undefined;
}

export interface PrCommentIssue {
  id?: string;
  title?: string;
  severity?: string;
  category?: string;
  description?: string;
}

export interface PrCommentBaselineComparison {
  overall?: { current: number; baseline: number; delta: number };
  usability?: { current: number; baseline: number; delta: number };
  accessibility?: { current: number; baseline: number; delta: number };
  clarity?: { current: number; baseline: number; delta: number };
  hasRegression: boolean;
  isNewPage: boolean;
}

export interface PrCommentConfig {
  thresholds?: {
    overall?: number;
    usability?: number;
    accessibility?: number;
    clarity?: number;
  };
  failOnCritical?: boolean;
  failOnRegression?: boolean;
  regressionThreshold?: number;
}

export interface PrCommentAudit {
  url: string;
  mode: string;
  jobId?: string;
  scores: PrCommentScores;
  issues: PrCommentIssue[];
  reportUrl?: string;
}

// Comment marker for finding existing comments
export const PR_COMMENT_MARKER = "<!-- vertaaux-audit-comment -->";

function formatDelta(delta: number | undefined): string {
  if (delta === undefined || delta === null) return "—";
  if (delta > 0) return `+${delta}`;
  if (delta < 0) return `${delta}`;
  return "—";
}

function getScoreStatus(
  score: number | undefined,
  threshold: number | undefined,
  delta: number | undefined,
): string {
  if (score === undefined) return "—";
  if (threshold !== undefined && score < threshold) return "fail";
  if (delta !== undefined && delta < 0) return "warn";
  return "pass";
}

interface GroupedIssues {
  critical: PrCommentIssue[];
  warning: PrCommentIssue[];
  info: PrCommentIssue[];
}

function groupIssuesBySeverity(issues: PrCommentIssue[]): GroupedIssues {
  const grouped: GroupedIssues = { critical: [], warning: [], info: [] };
  for (const issue of issues) {
    const severity = (issue.severity ?? "info").toLowerCase();
    if (severity === "critical" || severity === "error") {
      grouped.critical.push(issue);
    } else if (severity === "warning" || severity === "warn") {
      grouped.warning.push(issue);
    } else {
      grouped.info.push(issue);
    }
  }
  return grouped;
}

function formatIssue(issue: PrCommentIssue): string {
  const id = issue.id ? `**[${issue.id}]** ` : "";
  const title = issue.title ?? issue.description ?? "Unknown issue";
  return `- ${id}${title}`;
}

function determineOverallStatus(
  audit: PrCommentAudit,
  comparison: PrCommentBaselineComparison | null,
  config: PrCommentConfig,
): "pass" | "warn" | "fail" {
  const grouped = groupIssuesBySeverity(audit.issues);

  if (config.failOnCritical && grouped.critical.length > 0) return "fail";

  const thresholds = config.thresholds ?? {};
  const scores = audit.scores;
  const checks = [
    { score: scores.overall ?? scores.ux, threshold: thresholds.overall },
    { score: scores.usability ?? scores.ux, threshold: thresholds.usability },
    { score: scores.accessibility, threshold: thresholds.accessibility },
    { score: scores.clarity, threshold: thresholds.clarity },
  ];
  for (const { score, threshold } of checks) {
    if (score !== undefined && threshold !== undefined && score < threshold) {
      return "fail";
    }
  }

  if (config.failOnRegression && comparison?.hasRegression) return "fail";
  if (comparison?.hasRegression) return "warn";
  return "pass";
}

/**
 * Format audit results as a GitHub PR-comment markdown artifact.
 *
 * Byte-stable — identical inputs produce identical bytes across both the
 * GitHub Action and the MCP tool. Do not reformat without refreshing the
 * golden fixture.
 */
export function formatPrComment(
  audit: PrCommentAudit,
  comparison: PrCommentBaselineComparison | null,
  config: PrCommentConfig,
): string {
  const { url, mode, jobId, scores, issues, reportUrl } = audit;
  const grouped = groupIssuesBySeverity(issues);
  const overallStatus = determineOverallStatus(audit, comparison, config);
  const thresholds = config.thresholds ?? {};

  const statusText =
    overallStatus === "pass"
      ? "Passed"
      : overallStatus === "warn"
        ? "Warning"
        : "Failed";
  const statusIcon =
    overallStatus === "pass" ? "V" : overallStatus === "warn" ? "!" : "X";

  const scoreRows: string[] = [];
  const addScoreRow = (
    category: string,
    score: number | undefined,
    threshold: number | undefined,
    compData?: { current: number; baseline: number; delta: number },
  ): void => {
    if (score === undefined) return;
    const delta = compData?.delta;
    const deltaStr = formatDelta(delta);
    const deltaArrow =
      delta !== undefined && delta !== 0 ? (delta > 0 ? "up" : "down") : "same";
    const status = getScoreStatus(score, threshold, delta);
    const statusChar =
      status === "pass"
        ? "V"
        : status === "warn"
          ? "!"
          : status === "fail"
            ? "X"
            : "-";
    scoreRows.push(
      `| ${category} | ${score} | ${threshold ?? "-"} | ${deltaArrow === "up" ? "^" : deltaArrow === "down" ? "v" : "-"} ${deltaStr} | ${statusChar} |`,
    );
  };

  addScoreRow(
    "Overall",
    scores.overall ?? scores.ux,
    thresholds.overall,
    comparison?.overall,
  );
  addScoreRow(
    "Usability",
    scores.usability ?? scores.ux,
    thresholds.usability,
    comparison?.usability,
  );
  addScoreRow(
    "Accessibility",
    scores.accessibility,
    thresholds.accessibility,
    comparison?.accessibility,
  );
  addScoreRow("Clarity", scores.clarity, thresholds.clarity, comparison?.clarity);

  const totalIssues = issues.length;
  const issuesSummary = `${totalIssues} total: ${grouped.critical.length} critical, ${grouped.warning.length} warnings, ${grouped.info.length} info`;

  let issuesContent = "";
  if (grouped.critical.length > 0) {
    issuesContent += `\n#### Critical (${grouped.critical.length})\n`;
    issuesContent += grouped.critical.map(formatIssue).join("\n");
    issuesContent += "\n";
  }
  if (grouped.warning.length > 0) {
    issuesContent += `\n#### Warnings (${grouped.warning.length})\n`;
    issuesContent += grouped.warning.map(formatIssue).join("\n");
    issuesContent += "\n";
  }
  if (grouped.info.length > 0) {
    issuesContent += `\n#### Info (${grouped.info.length})\n`;
    issuesContent += grouped.info.map(formatIssue).join("\n");
    issuesContent += "\n";
  }

  let regressionBanner = "";
  if (comparison?.hasRegression) {
    regressionBanner = `
> **Warning:** Score regression detected compared to baseline. Review the changes below.

`;
  } else if (comparison?.isNewPage) {
    regressionBanner = `
> **Note:** New page - no baseline available. This result will become the baseline.

`;
  }

  const finalReportUrl =
    reportUrl ?? (jobId ? `https://vertaaux.ai/reports/${jobId}` : null);

  return `${PR_COMMENT_MARKER}
## VertaaUX Audit Results

**URL:** ${url}
**Mode:** ${mode} | **Status:** ${statusIcon} ${statusText}

${regressionBanner}### Scores

| Category | Score | Threshold | Delta | Status |
|----------|-------|-----------|-------|--------|
${scoreRows.join("\n")}

<details>
<summary>Issues (${issuesSummary})</summary>
${issuesContent || "\nNo issues found.\n"}
</details>

${
  finalReportUrl
    ? `<details>
<summary>Full Report</summary>

[View detailed report on VertaaUX](${finalReportUrl})

</details>
`
    : ""
}
---
*Powered by [VertaaUX](https://vertaaux.ai) | [Docs](https://docs.vertaaux.ai)*
`;
}
