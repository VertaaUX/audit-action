import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { loadBaseline, saveBaseline, createBaseline } from "../src/baseline.js";

// Layer 2 belt-and-braces: even if config.ts validation is bypassed, the
// fs-touching call sites in baseline.ts must refuse to escape repo root.
describe("baseline.ts resolveBaselinePath guard", () => {
  let tmpRepo: string;
  let originalCwd: string;

  before(() => {
    originalCwd = process.cwd();
    tmpRepo = fs.mkdtempSync(path.join(os.tmpdir(), "audit-action-test-"));
    process.chdir(tmpRepo);
  });

  after(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmpRepo, { recursive: true, force: true });
  });

  it("loadBaseline rejects an absolute path that escapes cwd", () => {
    assert.throws(
      () => loadBaseline("/etc/passwd"),
      /inside the repository checkout/
    );
  });

  it("loadBaseline rejects a traversal path that escapes cwd", () => {
    assert.throws(
      () => loadBaseline("../../../etc/passwd"),
      /inside the repository checkout/
    );
  });

  it("saveBaseline refuses to write outside cwd via absolute path", () => {
    assert.throws(
      () =>
        saveBaseline(
          "/tmp/vertaaux-poc.json",
          "https://example.com",
          { overall: 90 },
          0
        ),
      /inside the repository checkout/
    );
  });

  it("saveBaseline refuses to write outside cwd via traversal", () => {
    assert.throws(
      () =>
        saveBaseline(
          "../../../tmp/vertaaux-poc.json",
          "https://example.com",
          { overall: 90 },
          0
        ),
      /inside the repository checkout/
    );
  });

  it("createBaseline refuses to write outside cwd via absolute path", () => {
    assert.throws(
      () =>
        createBaseline("/tmp/vertaaux-poc.json", [
          {
            url: "https://example.com",
            scores: { overall: 90 },
            issuesCount: 0,
          },
        ]),
      /inside the repository checkout/
    );
  });

  it("loadBaseline returns null for the default path when no file exists", () => {
    assert.equal(loadBaseline(), null);
  });

  it("saveBaseline + loadBaseline round-trip works for an in-repo path", () => {
    saveBaseline(
      ".vertaaux-baseline.json",
      "https://example.com",
      { overall: 88, accessibility: 92 },
      3
    );
    const loaded = loadBaseline(".vertaaux-baseline.json");
    assert.ok(loaded);
    assert.equal(loaded.version, 1);
    const page = loaded.pages["https://example.com/"];
    assert.equal(page?.overall, 88);
    assert.equal(page?.accessibility, 92);
    assert.equal(page?.issues_count, 3);
  });
});
