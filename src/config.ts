/**
 * Config module for VertaaUX GitHub Action
 * Handles .vertaaux.yml configuration file parsing and merging
 */

import * as fs from "fs";
import * as path from "path";
import * as core from "@actions/core";
import * as yaml from "yaml";

export interface ThresholdConfig {
  overall?: number;
  usability?: number;
  accessibility?: number;
  clarity?: number;
}

export interface FileConfig {
  version?: number;
  thresholds?: ThresholdConfig;
  fail_on_critical?: boolean;
  fail_on_regression?: boolean;
  regression_threshold?: number;
  comment_on_pr?: boolean;
  update_existing_comment?: boolean;
  baseline_file?: string;
  update_baseline_on_main?: boolean;
  mode?: string;
}

export interface ActionInputs {
  threshold?: string;
  thresholds?: string;
  failOnCritical?: string;
  failOnRegression?: string;
  commentOnPr?: string;
  updateBaseline?: string;
  baselineFile?: string;
  configFile?: string;
  mode?: string;
}

export interface MergedConfig {
  thresholds: ThresholdConfig;
  failOnCritical: boolean;
  failOnRegression: boolean;
  regressionThreshold: number;
  commentOnPr: boolean;
  updateExistingComment: boolean;
  baselineFile: string;
  updateBaselineOnMain: boolean;
  mode: string;
}

const DEFAULT_CONFIG_PATH = ".vertaaux.yml";
const DEFAULT_BASELINE_PATH = ".vertaaux-baseline.json";

// Default configuration values
const DEFAULTS: MergedConfig = {
  thresholds: {},
  failOnCritical: true,
  failOnRegression: false,
  regressionThreshold: 5,
  commentOnPr: true,
  updateExistingComment: true,
  baselineFile: DEFAULT_BASELINE_PATH,
  updateBaselineOnMain: true,
  mode: "basic",
};

/**
 * Parse YAML-format thresholds from action input string
 */
function parseThresholdsInput(input: string): ThresholdConfig {
  if (!input?.trim()) {
    return {};
  }
  try {
    const parsed = yaml.parse(input);
    if (typeof parsed !== "object" || parsed === null) {
      return {};
    }
    return parsed as ThresholdConfig;
  } catch (error) {
    core.warning(`Failed to parse thresholds YAML: ${error}`);
    return {};
  }
}

/**
 * Load configuration from .vertaaux.yml file
 * Returns empty config if file doesn't exist
 */
export function loadConfig(configPath?: string): FileConfig {
  // Try specified path first, then default
  const paths = configPath
    ? [configPath]
    : [DEFAULT_CONFIG_PATH, ".vertaaux.yaml"];

  for (const tryPath of paths) {
    const resolvedPath = path.resolve(process.cwd(), tryPath);

    if (fs.existsSync(resolvedPath)) {
      try {
        const content = fs.readFileSync(resolvedPath, "utf-8");
        const parsed = yaml.parse(content) as FileConfig;

        if (typeof parsed !== "object" || parsed === null) {
          core.warning(`Invalid config file format: ${resolvedPath}`);
          return {};
        }

        core.debug(`Loaded config from: ${resolvedPath}`);
        return parsed;
      } catch (error) {
        core.warning(`Failed to parse config file: ${error}`);
        return {};
      }
    }
  }

  core.debug("No config file found, using defaults");
  return {};
}

/**
 * Parse boolean from string input
 * Returns default value if input is empty or invalid
 */
function parseBool(
  value: string | undefined,
  defaultValue: boolean
): boolean {
  if (value === undefined || value === "") {
    return defaultValue;
  }
  return value.toLowerCase() !== "false";
}

/**
 * Merge config file with action inputs
 * Action inputs take precedence over config file
 * Config file takes precedence over defaults
 */
export function mergeConfig(
  fileConfig: FileConfig,
  inputs: ActionInputs
): MergedConfig {
  // Start with defaults
  const config: MergedConfig = { ...DEFAULTS };

  // Apply file config (second priority)
  if (fileConfig.thresholds) {
    config.thresholds = { ...config.thresholds, ...fileConfig.thresholds };
  }
  if (fileConfig.fail_on_critical !== undefined) {
    config.failOnCritical = fileConfig.fail_on_critical;
  }
  if (fileConfig.fail_on_regression !== undefined) {
    config.failOnRegression = fileConfig.fail_on_regression;
  }
  if (fileConfig.regression_threshold !== undefined) {
    config.regressionThreshold = fileConfig.regression_threshold;
  }
  if (fileConfig.comment_on_pr !== undefined) {
    config.commentOnPr = fileConfig.comment_on_pr;
  }
  if (fileConfig.update_existing_comment !== undefined) {
    config.updateExistingComment = fileConfig.update_existing_comment;
  }
  if (fileConfig.baseline_file) {
    config.baselineFile = fileConfig.baseline_file;
  }
  if (fileConfig.update_baseline_on_main !== undefined) {
    config.updateBaselineOnMain = fileConfig.update_baseline_on_main;
  }
  if (fileConfig.mode) {
    config.mode = fileConfig.mode;
  }

  // Apply action inputs (highest priority)
  if (inputs.threshold) {
    const value = parseInt(inputs.threshold, 10);
    if (!isNaN(value)) {
      config.thresholds.overall = value;
    }
  }
  if (inputs.thresholds) {
    const parsed = parseThresholdsInput(inputs.thresholds);
    config.thresholds = { ...config.thresholds, ...parsed };
  }
  if (inputs.failOnCritical !== undefined && inputs.failOnCritical !== "") {
    config.failOnCritical = parseBool(inputs.failOnCritical, config.failOnCritical);
  }
  if (inputs.failOnRegression !== undefined && inputs.failOnRegression !== "") {
    config.failOnRegression = parseBool(inputs.failOnRegression, config.failOnRegression);
  }
  if (inputs.commentOnPr !== undefined && inputs.commentOnPr !== "") {
    config.commentOnPr = parseBool(inputs.commentOnPr, config.commentOnPr);
  }
  if (inputs.updateBaseline !== undefined && inputs.updateBaseline !== "") {
    config.updateBaselineOnMain = parseBool(inputs.updateBaseline, config.updateBaselineOnMain);
  }
  if (inputs.baselineFile) {
    config.baselineFile = inputs.baselineFile;
  }
  if (inputs.mode) {
    config.mode = inputs.mode;
  }

  return config;
}

/**
 * Validate thresholds are in valid range
 */
export function validateConfig(config: MergedConfig): string[] {
  const errors: string[] = [];

  const validateThreshold = (name: string, value: number | undefined) => {
    if (value !== undefined) {
      if (value < 0 || value > 100) {
        errors.push(`${name} threshold must be between 0 and 100`);
      }
    }
  };

  validateThreshold("overall", config.thresholds.overall);
  validateThreshold("usability", config.thresholds.usability);
  validateThreshold("accessibility", config.thresholds.accessibility);
  validateThreshold("clarity", config.thresholds.clarity);

  if (config.regressionThreshold < 0) {
    errors.push("regression_threshold must be non-negative");
  }

  return errors;
}
