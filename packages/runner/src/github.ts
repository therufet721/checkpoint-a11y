import { COMMENT_MARKER } from '@checkpoint-a11y/core';

export interface GithubCommentTarget {
  token: string;
  repo: string; // owner/name
  prNumber: number;
  apiUrl?: string;
}

/** Creates the Checkpoint A11y PR comment, or updates it in place if one exists. */
export async function upsertPrComment(target: GithubCommentTarget, body: string): Promise<'created' | 'updated'> {
  const api = (target.apiUrl ?? process.env.GITHUB_API_URL ?? 'https://api.github.com').replace(/\/$/, '');
  const headers = {
    authorization: `Bearer ${target.token}`,
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
    'content-type': 'application/json',
    'user-agent': 'checkpoint-a11y-runner',
  };
  let existing: number | undefined;
  for (let page = 1; page <= 10 && !existing; page++) {
    const res = await fetch(`${api}/repos/${target.repo}/issues/${target.prNumber}/comments?per_page=100&page=${page}`, { headers });
    if (!res.ok) throw new Error(`GitHub: listing comments failed with ${res.status}`);
    const comments = (await res.json()) as { id: number; body?: string }[];
    existing = comments.find((c) => c.body?.includes(COMMENT_MARKER))?.id;
    if (comments.length < 100) break;
  }
  const url = existing ? `${api}/repos/${target.repo}/issues/comments/${existing}` : `${api}/repos/${target.repo}/issues/${target.prNumber}/comments`;
  const res = await fetch(url, { method: existing ? 'PATCH' : 'POST', headers, body: JSON.stringify({ body }) });
  if (!res.ok) throw new Error(`GitHub: ${existing ? 'updating' : 'creating'} the comment failed with ${res.status}: ${await res.text()}`);
  return existing ? 'updated' : 'created';
}

/** Appends to the GitHub Actions job summary when running in Actions. */
export async function writeJobSummary(markdown: string): Promise<void> {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (!file) return;
  const fs = await import('node:fs/promises');
  await fs.appendFile(file, markdown.replace(COMMENT_MARKER, '') + '\n');
}
