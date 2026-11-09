import fs from 'node:fs/promises';
import path from 'node:path';
import { allOccurrences, groupOccurrences, renderEvidenceHtml, type RunResult } from '@checkpoint-a11y/core';
import type { ResolvedConfig } from './config';

/** Writes a local evidence pack (HTML) for the last run. The cloud version adds history and trend. */
export async function writeLocalReport(run: RunResult, config: ResolvedConfig, opts: { organization?: string; project?: string } = {}): Promise<string> {
  const flows = new Map<string, Set<string>>();
  for (const f of run.flows) {
    const set = flows.get(f.name) ?? new Set();
    f.checkpoints.forEach((c) => set.add(c.name));
    flows.set(f.name, set);
  }
  const issues = groupOccurrences(allOccurrences(run));
  const html = renderEvidenceHtml({
    organization: opts.organization ?? 'Your organization',
    project: opts.project ?? path.basename(config.rootDir),
    generatedAt: new Date().toISOString(),
    ruleset: run.ruleset,
    flows: [...flows].map(([name, cps]) => ({ name, checkpoints: [...cps] })),
    viewports: config.viewports.map((v) => `${v.name} ${v.width}×${v.height}`),
    openIssues: issues,
    runs: [{ at: run.finishedAt, commit: run.git.commit, branch: run.git.branch, open: issues.filter((i) => i.kind === 'violation').length }],
    fixedInPeriod: 0,
    waivers: config.policy.waivers,
  });
  const file = path.join(config.resultsDir, 'evidence.html');
  await fs.mkdir(config.resultsDir, { recursive: true });
  await fs.writeFile(file, html);
  return file;
}
