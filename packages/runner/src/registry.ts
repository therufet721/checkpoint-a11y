import type { BrowserContext, Page } from 'playwright';
import type { A11y } from './checkpoint';

export interface FlowContext {
  page: Page;
  context: BrowserContext;
  a11y: A11y;
  baseURL: string;
  viewport: { name: string; width: number; height: number };
}

export interface FlowOptions {
  /** Only run at these viewport names. */
  viewports?: string[];
  skip?: boolean;
  /** Per-flow timeout in milliseconds. Default 120000. */
  timeout?: number;
}

export interface FlowDefinition {
  name: string;
  fn: (ctx: FlowContext) => Promise<void>;
  options: FlowOptions;
  file?: string;
}

interface Registry {
  flows: FlowDefinition[];
  currentFile?: string;
}

// Shared through globalThis so flow files loaded by jiti (possibly as a separate module instance)
// register into the same list the CLI reads.
const KEY = Symbol.for('checkpoint-a11y.registry');
function registry(): Registry {
  const g = globalThis as unknown as Record<symbol, Registry>;
  return (g[KEY] ??= { flows: [] });
}

export function flow(name: string, fn: FlowDefinition['fn']): void;
export function flow(name: string, options: FlowOptions, fn: FlowDefinition['fn']): void;
export function flow(name: string, a: FlowOptions | FlowDefinition['fn'], b?: FlowDefinition['fn']): void {
  const fn = typeof a === 'function' ? a : b!;
  const options = typeof a === 'function' ? {} : a;
  const r = registry();
  if (r.flows.some((f) => f.name === name)) throw new Error(`Duplicate flow name "${name}". Flow names must be unique: they are part of every issue fingerprint.`);
  r.flows.push({ name, fn, options, file: r.currentFile });
}

export function setCurrentFlowFile(file: string | undefined): void {
  registry().currentFile = file;
}

export function registeredFlows(): FlowDefinition[] {
  return registry().flows;
}

export function clearFlows(): void {
  registry().flows = [];
}
