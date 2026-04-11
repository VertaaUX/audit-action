# VertaaUX Audit Action

Run UX audits in your CI/CD pipeline with configurable score thresholds, PR comments, and regression detection.

## Overview

This GitHub Action runs VertaaUX audits on your deployed URLs and provides:

- Usability, clarity, and accessibility scores
- Issue detection with severity levels
- Configurable pass/fail thresholds
- **PR comments with score trends and issues**
- **Regression detection against baseline**
- Full audit report links

See the [VertaaUX Documentation](https://vertaaux.ai/docs) for more details.

## Quick Start

```yaml
- uses: vertaaux/audit-action@v1
  with:
    url: https://example.com
    api-key: ${{ secrets.VERTAAUX_API_KEY }}
```

## Full Example with PR Comments

```yaml
name: UX Audit

on:
  pull_request:
  push:
    branches: [main]

jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Deploy preview
        id: deploy
        # ... your deployment step

      - name: Run UX Audit
        uses: vertaaux/audit-action@v1
        id: audit
        with:
          url: ${{ steps.deploy.outputs.url }}
          api-key: ${{ secrets.VERTAAUX_API_KEY }}
          github-token: ${{ secrets.GITHUB_TOKEN }}
          mode: standard
          threshold: 70
          thresholds: |
            usability: 75
            accessibility: 80
            clarity: 65
          fail-on-critical: true
          comment-on-pr: true

      - name: Display Results
        run: |
          echo "Overall: ${{ steps.audit.outputs.overall-score }}"
          echo "Usability: ${{ steps.audit.outputs.usability-score }}"
          echo "Accessibility: ${{ steps.audit.outputs.accessibility-score }}"
          echo "Issues: ${{ steps.audit.outputs.issues-count }}"
          echo "Report: ${{ steps.audit.outputs.report-url }}"
          echo "Regression: ${{ steps.audit.outputs.regression-detected }}"
```

## Inputs

| Input | Description | Required | Default |
|-------|-------------|----------|---------|
| `url` | URL to audit | Yes | - |
| `api-key` | VertaaUX API key | Yes | - |
| `github-token` | GitHub token for PR comments | No | `${{ github.token }}` |
| `mode` | Audit mode (`basic`, `standard`, `deep`) | No | `basic` |
| `wait` | Wait for audit completion | No | `true` |
| `timeout` | Wait timeout in milliseconds | No | `120000` |
| `threshold` | Overall score threshold (fail if below) | No | - |
| `thresholds` | Per-category thresholds in YAML format | No | - |
| `fail-on-critical` | Fail if critical issues found | No | `true` |
| `fail-on-regression` | Fail if scores regress from baseline | No | `false` |
| `comment-on-pr` | Post comment on pull request | No | `true` |
| `update-baseline` | Update baseline file | No | `false` |
| `baseline-file` | Path to baseline file | No | `.vertaaux-baseline.json` |
| `config-file` | Path to `.vertaaux.yml` config file | No | - |

### Threshold Format

Per-category thresholds use YAML format:

```yaml
thresholds: |
  usability: 75
  accessibility: 80
  clarity: 65
```

## Outputs

| Output | Description |
|--------|-------------|
| `overall-score` | Overall score (0-100) |
| `usability-score` | Usability score (0-100) |
| `clarity-score` | Clarity score (0-100) |
| `accessibility-score` | Accessibility score (0-100) |
| `issues-count` | Total issues found |
| `critical-count` | Critical issues count |
| `report-url` | URL to full report on vertaaux.ai |
| `job-id` | Audit job ID |
| `result-json` | Full JSON result |
| `regression-detected` | Whether a score regression was detected |
| `baseline-comparison` | JSON comparison to baseline |

## PR Comments

When running on pull requests with `comment-on-pr: true`, the action posts a rich comment with:

- Score breakdown with thresholds
- Delta comparisons to baseline (arrows showing improvement/regression)
- Issues organized by severity in expandable sections
- Link to full report

The comment is automatically updated on re-runs.

## Regression Detection

The action supports regression detection by comparing current scores to a baseline file.

### Baseline File

The baseline file (`.vertaaux-baseline.json`) tracks scores for each audited URL:

```json
{
  "version": 1,
  "updated": "2026-01-24T10:30:00Z",
  "pages": {
    "https://example.com/": {
      "overall": 82,
      "usability": 85,
      "accessibility": 78,
      "clarity": 80,
      "issues_count": 12
    }
  }
}
```

### Updating Baseline

The baseline is automatically updated when:
- Running on main/master branch with `update_baseline_on_main: true` in config
- Running with `update-baseline: true` input

**Important:** The action updates the file but doesn't commit it. Add a commit step:

```yaml
- name: Run UX Audit
  uses: vertaaux/audit-action@v1
  with:
    url: https://example.com
    api-key: ${{ secrets.VERTAAUX_API_KEY }}
    update-baseline: true

- name: Commit baseline update
  if: github.ref == 'refs/heads/main'
  run: |
    git config user.name "github-actions[bot]"
    git config user.email "github-actions[bot]@users.noreply.github.com"
    git add .vertaaux-baseline.json
    git diff --staged --quiet || git commit -m "chore: update UX baseline"
    git push
```

### Regression Behavior

- **Default:** Regression shows as warning but doesn't fail the check
- **Strict:** Set `fail-on-regression: true` to fail on any regression
- **Threshold:** Configure `regression_threshold` in config to allow small fluctuations

## Config File

You can define defaults in a `.vertaaux.yml` file in your repository:

```yaml
# .vertaaux.yml
version: 1

# Default thresholds (can be overridden in workflow)
thresholds:
  overall: 70
  usability: 75
  accessibility: 80
  clarity: 65

# Behavior options
fail_on_critical: true
fail_on_regression: false
regression_threshold: 5     # Points drop to trigger warning

# Comment options
comment_on_pr: true
update_existing_comment: true

# Baseline options
baseline_file: .vertaaux-baseline.json
update_baseline_on_main: true
```

Then reference it (or just place it at `.vertaaux.yml` for auto-detection):

```yaml
- uses: vertaaux/audit-action@v1
  with:
    url: https://example.com
    api-key: ${{ secrets.VERTAAUX_API_KEY }}
    config-file: .vertaaux.yml
```

Workflow inputs override config file settings.

## Obtaining an API Key

1. Sign up at [vertaaux.ai](https://vertaaux.ai)
2. Go to Settings > API Keys
3. Create a new API key
4. Add it to your repository secrets as `VERTAAUX_API_KEY`

## Audit Modes

| Mode | Description | Recommended For |
|------|-------------|-----------------|
| `basic` | Quick scan of key pages | PR previews, frequent runs |
| `standard` | Comprehensive single-page audit | Most use cases |
| `deep` | Multi-page crawl with full analysis | Release validation |

## Threshold Behavior

The action fails (sets check to failed) when ANY of these conditions are met:

- Overall score below `threshold`
- Any category score below its threshold in `thresholds`
- Critical issues found (if `fail-on-critical: true`)
- Score regression detected (if `fail-on-regression: true`)

## Troubleshooting

### Authentication Errors

```
Error: VERTAAUX_API_KEY is required
```

Ensure your API key is set in repository secrets and passed to the action.

### Timeout Errors

```
Error: Timed out waiting for audit
```

Increase the `timeout` value or use `mode: basic` for faster audits.

### PR Comment Not Appearing

Ensure you have:
- `github-token` input set (uses `${{ secrets.GITHUB_TOKEN }}` by default)
- `comment-on-pr: true` (default)
- Running on a pull_request event

### Debugging

Enable step debugging to see detailed logs:

```yaml
env:
  ACTIONS_STEP_DEBUG: true
```

### Common Issues

| Issue | Solution |
|-------|----------|
| 401 Unauthorized | Check API key is valid and not expired |
| Timeout | Increase timeout or use lighter mode |
| URL not accessible | Ensure URL is publicly accessible |
| Score below threshold | Review report and fix issues |
| No PR comment | Check github-token is provided |
| Baseline not updating | Add commit step after action |

## Examples

### Basic PR Check

```yaml
- uses: vertaaux/audit-action@v1
  with:
    url: ${{ env.PREVIEW_URL }}
    api-key: ${{ secrets.VERTAAUX_API_KEY }}
```

### Strict Accessibility Gate

```yaml
- uses: vertaaux/audit-action@v1
  with:
    url: https://example.com
    api-key: ${{ secrets.VERTAAUX_API_KEY }}
    thresholds: |
      accessibility: 90
    fail-on-critical: true
```

### Production Deployment Gate with Regression Check

```yaml
- uses: vertaaux/audit-action@v1
  with:
    url: https://example.com
    api-key: ${{ secrets.VERTAAUX_API_KEY }}
    mode: deep
    threshold: 80
    thresholds: |
      usability: 85
      accessibility: 90
      clarity: 75
    fail-on-regression: true
    update-baseline: ${{ github.ref == 'refs/heads/main' }}
```

### PR with Comment and Baseline Comparison

```yaml
name: UX Audit

on:
  pull_request:
  push:
    branches: [main]

jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Run UX Audit
        uses: vertaaux/audit-action@v1
        with:
          url: https://staging.example.com
          api-key: ${{ secrets.VERTAAUX_API_KEY }}
          github-token: ${{ secrets.GITHUB_TOKEN }}
          comment-on-pr: true
          threshold: 75

      - name: Update baseline on main
        if: github.ref == 'refs/heads/main'
        uses: vertaaux/audit-action@v1
        with:
          url: https://example.com
          api-key: ${{ secrets.VERTAAUX_API_KEY }}
          update-baseline: true

      - name: Commit baseline
        if: github.ref == 'refs/heads/main'
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add .vertaaux-baseline.json
          git diff --staged --quiet || git commit -m "chore: update UX baseline"
          git push
```

## License

MIT
