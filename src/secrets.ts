/**
 * Secret-registration helpers for the VertaaUX GitHub Action.
 *
 * GitHub already masks values passed via `${{ secrets.X }}`, so calling
 * `core.setSecret` here is defense in depth (CWE-532). It catches:
 * - Workflows that pass a literal token in the YAML.
 * - Workflows that pull a token from a non-secret source (env var,
 *   downloaded artifact, output of another step) and feed it to `with:`.
 * - The `github-token` default `${{ github.token }}` (which the runner
 *   already protects, but re-registering is a no-op for already-masked
 *   strings).
 *
 * Lives in its own file so it can be unit-tested without importing
 * `index.ts` (which auto-runs the action on import).
 */

import * as core from "@actions/core";

/**
 * Register both sensitive action inputs with the runner so they are
 * masked in workflow logs.
 *
 * Empty strings are ignored: `setSecret("")` would register the empty
 * string as a secret, which the runner could then redact spuriously.
 */
export function registerInputSecrets(
  apiKey: string,
  githubToken: string
): void {
  if (apiKey) {
    core.setSecret(apiKey);
  }
  if (githubToken) {
    core.setSecret(githubToken);
  }
}
