import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

function readVersion(pkg: string): string {
  try {
    return (require(pkg) as { version: string }).version;
  } catch {
    return 'unknown';
  }
}

export const TOOL_VERSION: string = readVersion('../package.json');
export const AXE_VERSION: string = readVersion('axe-core/package.json');
