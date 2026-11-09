import { createHash } from 'node:crypto';

function hash(parts: (string | undefined)[]): string {
  return createHash('sha256').update(parts.map((p) => p ?? '').join('\u001f')).digest('hex').slice(0, 16);
}

export interface FingerprintInput {
  ruleId: string;
  component?: string;
  normalizedSelector: string;
  flow: string;
  checkpoint: string;
}

/** The subject of an issue: the component when attribution worked, the normalized selector otherwise. */
export function issueSubject(input: Pick<FingerprintInput, 'component' | 'normalizedSelector'>): string {
  return input.component ? `cmp:${input.component}` : `sel:${input.normalizedSelector}`;
}

/** hash(rule id + component or normalized selector + flow name + checkpoint name) */
export function fingerprint(input: FingerprintInput): string {
  return hash([input.ruleId, issueSubject(input), input.flow, input.checkpoint]);
}

/** hash(rule id + component or normalized selector): the same root cause everywhere it appears. */
export function rootCauseKey(input: Pick<FingerprintInput, 'ruleId' | 'component' | 'normalizedSelector'>): string {
  return hash([input.ruleId, issueSubject(input)]);
}
