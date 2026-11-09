import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import type { GitInfo } from '@checkpoint-a11y/core';

function git(args: string[], cwd: string): string | undefined {
  try {
    return execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || undefined;
  } catch {
    return undefined;
  }
}

/** Reads commit, branch and PR from CI environment variables, falling back to the local git checkout. */
export function detectGit(cwd: string, env: NodeJS.ProcessEnv = process.env): GitInfo {
  const info: GitInfo = {};

  if (env.GITHUB_ACTIONS) {
    info.repo = env.GITHUB_REPOSITORY;
    info.commit = env.GITHUB_SHA;
    info.branch = env.GITHUB_HEAD_REF || env.GITHUB_REF_NAME;
    info.baseBranch = env.GITHUB_BASE_REF || undefined;
    const m = /^refs\/pull\/(\d+)\//.exec(env.GITHUB_REF ?? '');
    if (m) info.prNumber = Number(m[1]);
    if (env.GITHUB_EVENT_PATH && fs.existsSync(env.GITHUB_EVENT_PATH)) {
      try {
        const event = JSON.parse(fs.readFileSync(env.GITHUB_EVENT_PATH, 'utf8'));
        if (event.pull_request) {
          info.prNumber = event.pull_request.number;
          // GITHUB_SHA is the merge commit on pull_request events; the head commit is what the developer pushed.
          info.commit = event.pull_request.head?.sha ?? info.commit;
          info.baseBranch = event.pull_request.base?.ref ?? info.baseBranch;
        }
      } catch {
        /* ignore malformed event file */
      }
    }
  } else if (env.GITLAB_CI) {
    info.repo = env.CI_PROJECT_PATH;
    info.commit = env.CI_COMMIT_SHA;
    info.branch = env.CI_MERGE_REQUEST_SOURCE_BRANCH_NAME || env.CI_COMMIT_REF_NAME;
    info.baseBranch = env.CI_MERGE_REQUEST_TARGET_BRANCH_NAME || undefined;
    if (env.CI_MERGE_REQUEST_IID) info.prNumber = Number(env.CI_MERGE_REQUEST_IID);
  } else if (env.TF_BUILD) {
    info.commit = env.BUILD_SOURCEVERSION;
    info.branch = (env.SYSTEM_PULLREQUEST_SOURCEBRANCH || env.BUILD_SOURCEBRANCH || '').replace(/^refs\/heads\//, '') || undefined;
    info.baseBranch = (env.SYSTEM_PULLREQUEST_TARGETBRANCH || '').replace(/^refs\/heads\//, '') || undefined;
    if (env.SYSTEM_PULLREQUEST_PULLREQUESTID) info.prNumber = Number(env.SYSTEM_PULLREQUEST_PULLREQUESTID);
  }

  info.commit ??= git(['rev-parse', 'HEAD'], cwd);
  info.branch ??= git(['rev-parse', '--abbrev-ref', 'HEAD'], cwd);
  if (info.branch === 'HEAD') info.branch = undefined;
  return info;
}
