import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { registerInputSecrets } from "../src/secrets.js";

// `@actions/core` writes secret-mask directives to stdout in the form
// `::add-mask::<value>`. Capture stdout for the duration of each test so we
// can assert what the runner would actually see (CWE-532 mitigation).
function withStdoutCapture<T>(fn: () => T): { result: T; output: string } {
  const captured: string[] = [];
  const originalWrite = process.stdout.write.bind(process.stdout);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (process.stdout as any).write = (
    chunk: string | Uint8Array,
    ...rest: unknown[]
  ): boolean => {
    captured.push(
      typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf-8")
    );
    return originalWrite(chunk as string, ...(rest as []));
  };
  try {
    const result = fn();
    return { result, output: captured.join("") };
  } finally {
    (process.stdout as { write: typeof originalWrite }).write = originalWrite;
  }
}

describe("registerInputSecrets", () => {
  it("registers the api-key as a secret", () => {
    const { output } = withStdoutCapture(() => {
      registerInputSecrets(
        "vx_live_TEST_KEY_THAT_MUST_BE_MASKED_aBc123",
        ""
      );
    });
    assert.match(
      output,
      /::add-mask::vx_live_TEST_KEY_THAT_MUST_BE_MASKED_aBc123/
    );
  });

  it("registers the github-token as a secret when provided", () => {
    const { output } = withStdoutCapture(() => {
      registerInputSecrets("any-api", "ghs_TEST_TOKEN_xyz789");
    });
    assert.match(output, /::add-mask::any-api/);
    assert.match(output, /::add-mask::ghs_TEST_TOKEN_xyz789/);
  });

  it("does not call setSecret when github-token is empty", () => {
    const { output } = withStdoutCapture(() => {
      registerInputSecrets("api-only", "");
    });
    assert.match(output, /::add-mask::api-only/);
    // Only one mask directive should appear (for api-only).
    const matches = output.match(/::add-mask::/g) ?? [];
    assert.equal(matches.length, 1);
  });

  it("does not call setSecret when api-key is empty (defensive)", () => {
    // run() requires api-key, so an empty value should never reach this
    // helper in practice. But the helper itself must not blow up if called
    // with an empty string (e.g. unit tests, future call sites).
    const { output } = withStdoutCapture(() => {
      registerInputSecrets("", "");
    });
    const matches = output.match(/::add-mask::/g) ?? [];
    assert.equal(matches.length, 0);
  });

  it("registers both inputs in a single call", () => {
    const { output } = withStdoutCapture(() => {
      registerInputSecrets("KEY_AAA", "TOKEN_BBB");
    });
    const matches = output.match(/::add-mask::/g) ?? [];
    assert.equal(matches.length, 2);
    assert.match(output, /::add-mask::KEY_AAA/);
    assert.match(output, /::add-mask::TOKEN_BBB/);
  });
});
