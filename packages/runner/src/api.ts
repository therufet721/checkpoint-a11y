import fs from 'node:fs/promises';
import path from 'node:path';
import type { Baseline, GateDiff, GatePolicy, RunResult } from '@checkpoint-a11y/core';

export interface UploadResponse {
  runId: string;
  diff: GateDiff;
  comment: string;
  dashboardUrl?: string;
}

export interface ApiClientOptions {
  url: string;
  token: string;
}

async function request<T>(opts: ApiClientOptions, method: string, route: string, body?: unknown): Promise<T> {
  const res = await fetch(new URL(route.replace(/^\//, ''), opts.url.endsWith('/') ? opts.url : opts.url + '/'), {
    method,
    headers: { authorization: `Bearer ${opts.token}`, 'content-type': 'application/json', 'user-agent': 'checkpoint-a11y-runner' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Checkpoint A11y API ${method} ${route} failed: ${res.status} ${await res.text().catch(() => '')}`.trim());
  return (await res.json()) as T;
}

/** Uploads the run with its screenshots. The API diffs it against the stored baseline and returns the verdict. */
export async function uploadRun(opts: ApiClientOptions, run: RunResult, resultsDir: string, policy: GatePolicy): Promise<UploadResponse> {
  const artifacts: Record<string, string> = {};
  const paths = new Set<string>();
  for (const f of run.flows) {
    for (const c of f.checkpoints) {
      if (c.screenshot) paths.add(c.screenshot);
      for (const i of c.issues) if (i.screenshot) paths.add(i.screenshot);
    }
  }
  let total = 0;
  for (const p of paths) {
    try {
      const buf = await fs.readFile(path.join(resultsDir, p));
      total += buf.length;
      if (total > 40 * 1024 * 1024) break; // stay under the API body limit
      artifacts[p] = buf.toString('base64');
    } catch {
      /* missing file, skip */
    }
  }
  return request<UploadResponse>(opts, 'POST', '/v1/runs', { run, artifacts, policy });
}

export async function fetchBaseline(opts: ApiClientOptions, branch?: string): Promise<Baseline | null> {
  const r = await request<{ baseline: Baseline | null }>(opts, 'GET', `/v1/baseline${branch ? `?branch=${encodeURIComponent(branch)}` : ''}`);
  return r.baseline;
}
