import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as path from "node:path";

import { mergeConfig, validateBaselineFile } from "../src/config.js";

describe("validateBaselineFile", () => {
  it("accepts the default-style relative path", () => {
    assert.equal(
      validateBaselineFile(".vertaaux-baseline.json", "test"),
      ".vertaaux-baseline.json"
    );
  });

  it("accepts a nested relative path under repo root", () => {
    const normalized = validateBaselineFile(
      ".audits/baseline.json",
      "test"
    );
    assert.equal(normalized, path.normalize(".audits/baseline.json"));
  });

  it("rejects an absolute POSIX path", () => {
    assert.throws(
      () => validateBaselineFile("/etc/passwd", "test"),
      /relative path/
    );
    assert.throws(
      () => validateBaselineFile("/tmp/vertaaux-poc.json", "test"),
      /relative path/
    );
  });

  it("rejects parent-directory traversal", () => {
    assert.throws(
      () => validateBaselineFile("../../etc/passwd", "test"),
      /\.\./
    );
    assert.throws(
      () => validateBaselineFile("foo/../../bar.json", "test"),
      /\.\./
    );
  });

  it("rejects writes into .github/workflows/", () => {
    // The reporter's RCE chain hinges on this exact target.
    assert.throws(
      () => validateBaselineFile(".github/workflows/backdoor.yml", "test"),
      /\.json/
    );
  });

  it("rejects non-.json basenames", () => {
    assert.throws(
      () => validateBaselineFile("baseline.yaml", "test"),
      /\.json/
    );
    assert.throws(
      () => validateBaselineFile("baseline", "test"),
      /\.json/
    );
  });

  it("rejects basenames with shell-special characters", () => {
    assert.throws(
      () => validateBaselineFile("base$line.json", "test"),
      /[A-Za-z0-9._-]/
    );
    assert.throws(
      () => validateBaselineFile("base line.json", "test"),
      /[A-Za-z0-9._-]/
    );
    assert.throws(
      () => validateBaselineFile("base;line.json", "test"),
      /[A-Za-z0-9._-]/
    );
  });

  it("includes the source label in the error message", () => {
    assert.throws(
      () => validateBaselineFile("/etc/passwd", "baseline-file input"),
      /baseline-file input/
    );
  });
});

describe("mergeConfig (security: baseline path)", () => {
  it("rejects malicious baseline-file action input", () => {
    assert.throws(
      () =>
        mergeConfig(
          {},
          { baselineFile: ".github/workflows/backdoor.yml" }
        ),
      /\.json/
    );
  });

  it("rejects malicious baseline_file in .vertaaux.yml", () => {
    assert.throws(
      () => mergeConfig({ baseline_file: "/etc/passwd" }, {}),
      /relative path/
    );
  });

  it("accepts valid action input and propagates it to merged config", () => {
    const merged = mergeConfig({}, { baselineFile: ".audits/baseline.json" });
    assert.equal(merged.baselineFile, path.normalize(".audits/baseline.json"));
  });

  it("falls back to the default when no override is supplied", () => {
    const merged = mergeConfig({}, {});
    assert.equal(merged.baselineFile, ".vertaaux-baseline.json");
  });
});
