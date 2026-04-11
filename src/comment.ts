/**
 * PR Comment module for VertaaUX GitHub Action.
 *
 * Thin adapter around the shared `lib/pr-comment-formatter.ts` formatter
 * (mirrored into `action/src/lib/pr-comment-formatter.ts` because action/
 * uses rootDir=./src). Retains the octokit POST/UPDATE wiring plus the
 * public types consumed by `action/src/index.ts`.
 */

import * as github from "@actions/github";

import {
  formatPrComment,
  PR_COMMENT_MARKER,
  type PrCommentAudit,
  type PrCommentBaselineComparison,
  type PrCommentConfig,
  type PrCommentIssue,
  type PrCommentScores,
} from "./lib/pr-comment-formatter.js";

// Re-export github types for convenience
type Octokit = ReturnType<typeof github.getOctokit>;
type Context = typeof github.context;

// Preserved public surface (consumed by action/src/index.ts).
export type AuditScores = PrCommentScores;
export type AuditIssue = PrCommentIssue;
export type BaselineComparison = PrCommentBaselineComparison;
export type CommentConfig = PrCommentConfig;
export type AuditResult = PrCommentAudit;

// Comment marker for finding existing comments
const COMMENT_MARKER = PR_COMMENT_MARKER;

/**
 * Format audit results as a GitHub PR comment. Delegates to the shared
 * `formatPrComment` — byte-stable across the Action and the MCP tool.
 */
export function formatComment(
  result: AuditResult,
  comparison: BaselineComparison | null,
  config: CommentConfig,
): string {
  return formatPrComment(result, comparison, config);
}

/**
 * Find existing VertaaUX comment on a PR
 */
export async function findExistingComment(
  octokit: Octokit,
  context: Context,
): Promise<number | null> {
  const { owner, repo } = context.repo;
  const issueNumber =
    context.payload.pull_request?.number || context.issue?.number;

  if (!issueNumber) {
    return null;
  }

  try {
    const { data: comments } = await octokit.rest.issues.listComments({
      owner,
      repo,
      issue_number: issueNumber,
      per_page: 100,
    });

    const existingComment = comments.find(
      (comment) =>
        comment.body?.includes(COMMENT_MARKER) &&
        comment.user?.type === "Bot",
    );

    return existingComment?.id || null;
  } catch {
    return null;
  }
}

/**
 * Post a new comment on a PR
 */
export async function postComment(
  octokit: Octokit,
  context: Context,
  body: string,
): Promise<number> {
  const { owner, repo } = context.repo;
  const issueNumber =
    context.payload.pull_request?.number || context.issue?.number;

  if (!issueNumber) {
    throw new Error("No pull request or issue number found in context");
  }

  const { data: comment } = await octokit.rest.issues.createComment({
    owner,
    repo,
    issue_number: issueNumber,
    body,
  });

  return comment.id;
}

/**
 * Update an existing comment
 */
export async function updateComment(
  octokit: Octokit,
  context: Context,
  commentId: number,
  body: string,
): Promise<void> {
  const { owner, repo } = context.repo;

  await octokit.rest.issues.updateComment({
    owner,
    repo,
    comment_id: commentId,
    body,
  });
}
