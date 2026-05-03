import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { validateConfigFile, loadConfig } from "../src/config.js";

describe("validateConfigFile", () => {
  it("accepts the default-style relative .yml path", () => {
    assert.equal(
      validateConfigFile(".vertaaux.yml", "test"),
      ".vertaaux.yml"
    );
  });

  it("accepts a relative .yaml path", () => {
    assert.equal(
      validateConfigFile(".vertaaux.yaml", "test"),
      ".vertaaux.yaml"
    );
  });

  it("accepts a nested relative path under repo root", () => {
    const normalized = validateConfigFile(".configs/audit.yml", "test");
    assert.equal(normalized, path.normalize(".configs/audit.yml"));
  });

  it("rejects /proc/self/environ (the reporter's env-leak vector)", () => {
    assert.throws(
      () => validateConfigFile("/proc/self/environ", "config-file input"),
      /relative path/
    );
  });

  it("rejects an absolute path to /etc/passwd", () => {
    assert.throws(
      () => validateConfigFile("/etc/passwd", "test"),
      /relative path/
    );
  });

  it("rejects parent-directory traversal targeting .env", () => {
    assert.throws(
      () => validateConfigFile("../../../../.env", "test"),
      /\.\./
    );
  });

  it("rejects ~/.aws/credentials shape", () => {
    // The literal '~' is treated as a relative path component on
    // most filesystems; node does not expand it. Even so, the basename
    // pattern must reject 'credentials' (no .yml/.yaml extension).
    assert.throws(
      () => validateConfigFile("~/.aws/credentials", "test"),
      /\.yml or \.yaml/
    );
  });

  it("rejects .env files (no yaml extension)", () => {
    assert.throws(
      () => validateConfigFile(".env", "test"),
      /\.yml or \.yaml/
    );
  });

  it("rejects .json files (would be confusing to accept)", () => {
    assert.throws(
      () => validateConfigFile("config.json", "test"),
      /\.yml or \.yaml/
    );
  });

  it("rejects basenames with shell-special characters", () => {
    assert.throws(
      () => validateConfigFile("config$.yml", "test"),
      /[A-Za-z0-9._-]/
    );
    assert.throws(
      () => validateConfigFile("config space.yml", "test"),
      /[A-Za-z0-9._-]/
    );
  });

  it("includes the source label in the error message", () => {
    assert.throws(
      () => validateConfigFile("/proc/self/environ", "config-file input"),
      /config-file input/
    );
  });
});

describe("loadConfig (security: config-file)", () => {
  let tmpRepo: string;
  let originalCwd: string;

  before(() => {
    originalCwd = process.cwd();
    tmpRepo = fs.mkdtempSync(path.join(os.tmpdir(), "audit-action-cfg-"));
    process.chdir(tmpRepo);
  });

  after(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmpRepo, { recursive: true, force: true });
  });

  it("rejects /proc/self/environ via Layer 1 validation", () => {
    assert.throws(
      () => loadConfig("/proc/self/environ"),
      /relative path/
    );
  });

  it("rejects ../../../../.env via Layer 1 validation", () => {
    assert.throws(
      () => loadConfig("../../../../.env"),
      /\.\./
    );
  });

  it("returns empty config when no file exists at the validated path", () => {
    const result = loadConfig(".vertaaux.yml");
    assert.deepEqual(result, {});
  });

  it("loads a valid YAML file from a relative path", () => {
    fs.writeFileSync(
      path.join(tmpRepo, ".vertaaux.yml"),
      "fail_on_critical: false\nregression_threshold: 7\n",
      "utf-8"
    );
    const result = loadConfig(".vertaaux.yml");
    assert.equal(result.fail_on_critical, false);
    assert.equal(result.regression_threshold, 7);
  });

  it("does not echo file contents in the parse-error warning (env-leak mitigation)", () => {
    // @actions/core writes warnings as `::warning::<msg>` to stdout in GHA
    // mode. Intercept process.stdout.write for the duration of the call so
    // we can assert what actually gets logged. This is the same channel a
    // real Actions runner would surface to the workflow log.
    const captured: string[] = [];
    const originalWrite = process.stdout.write.bind(process.stdout);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (process.stdout as any).write = (
      chunk: string | Uint8Array,
      ...rest: unknown[]
    ): boolean => {
      const str = typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf-8");
      captured.push(str);
      return originalWrite(chunk as string, ...(rest as []));
    };

    try {
      // Write a "secret"-bearing file that is not valid YAML. /proc/self/environ
      // uses NUL separators, which yaml.parse chokes on and would otherwise
      // echo a snippet of in its error message — partially defeating the
      // path-traversal mitigation for runner-resident secret stores.
      const secretMarker = "GHP_TOKEN_THAT_MUST_NOT_LEAK_abc123def456";
      fs.writeFileSync(
        path.join(tmpRepo, "leaky.yml"),
        `: ${secretMarker}\n: : :\n\t\t\t`,
        "utf-8"
      );

      loadConfig("leaky.yml");

      // The warning channel must mention the path (operationally useful) but
      // must not contain any byte from the file content.
      const allOutput = captured.join("");
      assert.ok(
        allOutput.includes("Failed to parse config file at"),
        "expected the path-only warning to fire"
      );
      assert.ok(
        !allOutput.includes(secretMarker),
        `warning leaked file content. Captured: ${JSON.stringify(allOutput)}`
      );
    } finally {
      (process.stdout as { write: typeof originalWrite }).write = originalWrite;
    }
  });
});
