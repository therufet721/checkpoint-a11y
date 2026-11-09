#!/usr/bin/env node
import path from 'node:path';
import { parseArgs } from 'node:util';
import { loadConfig } from './config';
import { EXIT, gate } from './gate';
import { init } from './init';
import { writeLocalReport } from './report';
import { collectFlowResults, readLastRun, runAll } from './run';
import { TOOL_VERSION } from './version';

const HELP = `checkpoint-a11y ${TOOL_VERSION}

Usage: checkpoint-a11y <command> [options]

Commands:
  run        Run flows, check every checkpoint, and gate against the baseline
  gate       Gate results already written by the Playwright fixture
  baseline   Record the last results as the new local baseline
  report     Write a local evidence pack (HTML) for the last results
  init       Create a config, an example flow and a GitHub workflow

Options:
  -c, --config <file>     Config file (default: checkpoint-a11y.config.ts)
      --base-url <url>    Override baseURL
  -g, --grep <text>       Only run flows whose name contains <text>
      --update-baseline   Write the baseline from this run (local mode)
      --comment           Post or update the PR comment (needs GITHUB_TOKEN)
      --offline           Do not upload, even if CHECKPOINT_A11Y_TOKEN is set
      --no-gate           Run checks only; always exit 0 unless the tool fails
      --headed            Show the browser
  -h, --help              Show this help
  -v, --version           Show the version

Exit codes: 0 passed, 1 new blocking issues, 2 a flow failed, 3 tool error.
`;

async function main(): Promise<number> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      config: { type: 'string', short: 'c' },
      'base-url': { type: 'string' },
      grep: { type: 'string', short: 'g' },
      'update-baseline': { type: 'boolean' },
      comment: { type: 'boolean' },
      offline: { type: 'boolean' },
      'no-gate': { type: 'boolean' },
      headed: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'v' },
    },
  });
  const log = (m: string) => console.log(m);
  const command = positionals[0] ?? (values.help ? 'help' : values.version ? 'version' : 'help');
  if (command === 'help') return void console.log(HELP), EXIT.ok;
  if (command === 'version') return void console.log(TOOL_VERSION), EXIT.ok;
  if (command === 'init') return await init(process.cwd(), log), EXIT.ok;

  const config = await loadConfig(process.cwd(), values.config, { baseURL: values['base-url'] });
  const gateOpts = { comment: values.comment, updateBaseline: values['update-baseline'], offline: values.offline, log };

  switch (command) {
    case 'run': {
      const run = await runAll(config, { grep: values.grep, headed: values.headed, log });
      const outcome = await gate(run, config, gateOpts);
      log(`Results: ${path.relative(process.cwd(), config.resultsDir)}`);
      return values['no-gate'] ? EXIT.ok : outcome.exitCode;
    }
    case 'gate': {
      const run = await collectFlowResults(config);
      const outcome = await gate(run, config, gateOpts);
      return values['no-gate'] ? EXIT.ok : outcome.exitCode;
    }
    case 'baseline': {
      const run = await readLastRun(config);
      await gate(run, config, { ...gateOpts, updateBaseline: true, offline: true, comment: false });
      return EXIT.ok;
    }
    case 'report': {
      const run = await readLastRun(config);
      const file = await writeLocalReport(run, config);
      log(`Evidence pack written to ${path.relative(process.cwd(), file)}`);
      return EXIT.ok;
    }
    default:
      console.error(`Unknown command "${command}".\n\n${HELP}`);
      return EXIT.toolError;
  }
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(`checkpoint-a11y: ${(err as Error).message}`);
    if (process.env.CHECKPOINT_A11Y_DEBUG) console.error(err);
    process.exit(EXIT.toolError);
  },
);
