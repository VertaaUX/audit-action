/**
 * Baseline module for VertaaUX GitHub Action
 * Handles regression detection via committed baseline file
 */

/* eslint-disable security/detect-non-literal-fs-filename, security/detect-object-injection -- fs paths are validated by resolveBaselinePath() / validateBaselineFile(); page-keyed object access is the data shape of BaselineData.pages */

import * as fs from "fs";
import * as path from "path";
import * as core from "@actions/core";

export interface BaselineScores {
  overall?: number;
  usability?: number;
  accessibility?: number;
  clarity?: number;
  issues_count?: number;
}

export interface BaselineData {
  version: number;
  updated: string;
  pages: Record<string, BaselineScores>;
}

export interface ScoreComparison {
  overall?: { current: number; baseline: number; delta: number };
  usability?: { current: number; baseline: number; delta: number };
  accessibility?: { current: number; baseline: number; delta: number };
  clarity?: { current: number; baseline: number; delta: number };
  hasRegression: boolean;
  isNewPage: boolean;
}

export interface CurrentScores {
  overall?: number;
  usability?: number;
  ux?: number;
  accessibility?: number;
  clarity?: number;
}

const DEFAULT_BASELINE_PATH = ".vertaaux-baseline.json";

/**
 * Resolve `baselinePath` against `process.cwd()` and assert the result stays
 * inside the repository checkout.
 *
 * Layer 1 in `config.ts` already rejects absolute paths and `..` traversal at
 * input time; this is belt-and-braces in case a future code path reaches the
 * fs APIs without going through that validator (CWE-22 defense in depth).
 */
function resolveBaselinePath(baselinePath: string | undefined): string {
  const cwd = path.resolve(process.cwd());
  const filePath = path.resolve(cwd, baselinePath || DEFAULT_BASELINE_PATH);

  if (filePath !== cwd && !filePath.startsWith(cwd + path.sep)) {
    throw new Error(
      `baseline path must resolve inside the repository checkout (got: ${filePath})`
    );
  }

  return filePath;
}

/**
 * Normalize URL for baseline key (remove trailing slashes, lowercase)
 */
function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    // Remove trailing slash from pathname unless it's just "/"
    if (parsed.pathname.length > 1 && parsed.pathname.endsWith("/")) {
      parsed.pathname = parsed.pathname.slice(0, -1);
    }
    return parsed.toString().toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

/**
 * Load baseline data from file
 * Returns null if file doesn't exist (new repo scenario)
 */
export function loadBaseline(baselinePath?: string): BaselineData | null {
  const filePath = resolveBaselinePath(baselinePath);

  if (!fs.existsSync(filePath)) {
    core.debug(`Baseline file not found: ${filePath}`);
    return null;
  }

  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const data = JSON.parse(content) as BaselineData;

    // Validate structure
    if (typeof data.version !== "number" || typeof data.pages !== "object") {
      core.warning(`Invalid baseline file structure: ${filePath}`);
      return null;
    }

    return data;
  } catch (error) {
    core.warning(`Failed to load baseline file: ${error}`);
    return null;
  }
}

/**
 * Save updated baseline data to file
 * Preserves other URLs in the baseline while updating the target URL
 */
export function saveBaseline(
  baselinePath: string | undefined,
  url: string,
  scores: CurrentScores,
  issuesCount: number
): void {
  const filePath = resolveBaselinePath(baselinePath);

  // Load existing baseline or create new
  let baseline = loadBaseline(baselinePath);

  if (!baseline) {
    baseline = {
      version: 1,
      updated: new Date().toISOString(),
      pages: {},
    };
  }

  // Normalize URL for consistent keying
  const normalizedUrl = normalizeUrl(url);

  // Update the page entry
  baseline.pages[normalizedUrl] = {
    overall: scores.overall ?? scores.ux,
    usability: scores.usability ?? scores.ux,
    accessibility: scores.accessibility,
    clarity: scores.clarity,
    issues_count: issuesCount,
  };

  // Update timestamp
  baseline.updated = new Date().toISOString();

  // Write to file
  try {
    const content = JSON.stringify(baseline, null, 2);
    fs.writeFileSync(filePath, content, "utf-8");
    core.info(`Baseline updated: ${filePath}`);
  } catch (error) {
    core.warning(`Failed to save baseline file: ${error}`);
    throw error;
  }
}

/**
 * Compare current scores to baseline for regression detection
 * Returns null if URL not in baseline (new page)
 */
export function compareToBaseline(
  baseline: BaselineData | null,
  url: string,
  currentScores: CurrentScores,
  regressionThreshold: number = 0
): ScoreComparison {
  // No baseline file at all
  if (!baseline) {
    return {
      hasRegression: false,
      isNewPage: true,
    };
  }

  const normalizedUrl = normalizeUrl(url);
  const pageBaseline = baseline.pages[normalizedUrl];

  // URL not in baseline (new page)
  if (!pageBaseline) {
    return {
      hasRegression: false,
      isNewPage: true,
    };
  }

  const comparison: ScoreComparison = {
    hasRegression: false,
    isNewPage: false,
  };

  // Helper to compare a single category
  const compareCategory = (
    category: "overall" | "usability" | "accessibility" | "clarity",
    currentKey: keyof CurrentScores = category
  ) => {
    const baselineScore = pageBaseline[category];
    let currentScore = currentScores[currentKey];

    // Handle 'ux' alias for usability/overall
    if (currentScore === undefined && (category === "usability" || category === "overall")) {
      currentScore = currentScores.ux;
    }

    if (baselineScore !== undefined && currentScore !== undefined) {
      const delta = currentScore - baselineScore;
      comparison[category] = {
        current: currentScore,
        baseline: baselineScore,
        delta,
      };

      // Check for regression (score dropped more than threshold)
      if (delta < -regressionThreshold) {
        comparison.hasRegression = true;
      }
    }
  };

  compareCategory("overall");
  compareCategory("usability");
  compareCategory("accessibility");
  compareCategory("clarity");

  return comparison;
}

/**
 * Create a baseline for multiple URLs at once
 * Useful for initial baseline creation
 */
export function createBaseline(
  baselinePath: string | undefined,
  pages: Array<{
    url: string;
    scores: CurrentScores;
    issuesCount: number;
  }>
): void {
  const baseline: BaselineData = {
    version: 1,
    updated: new Date().toISOString(),
    pages: {},
  };

  for (const page of pages) {
    const normalizedUrl = normalizeUrl(page.url);
    baseline.pages[normalizedUrl] = {
      overall: page.scores.overall ?? page.scores.ux,
      usability: page.scores.usability ?? page.scores.ux,
      accessibility: page.scores.accessibility,
      clarity: page.scores.clarity,
      issues_count: page.issuesCount,
    };
  }

  const filePath = resolveBaselinePath(baselinePath);

  const content = JSON.stringify(baseline, null, 2);
  fs.writeFileSync(filePath, content, "utf-8");
  core.info(`Baseline created: ${filePath}`);
}
