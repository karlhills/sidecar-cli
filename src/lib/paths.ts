import fs from 'node:fs';
import path from 'node:path';

export const SIDECAR_DIR = '.sidecar';

export interface SidecarPaths {
  rootPath: string;
  sidecarPath: string;
  dbPath: string;
  configPath: string;
  agentsPath: string;
  summaryPath: string;
}

export function getSidecarPaths(rootPath: string): SidecarPaths {
  const sidecarPath = path.join(rootPath, SIDECAR_DIR);
  return {
    rootPath,
    sidecarPath,
    dbPath: path.join(sidecarPath, 'sidecar.db'),
    configPath: path.join(sidecarPath, 'config.json'),
    agentsPath: path.join(sidecarPath, 'AGENTS.md'),
    summaryPath: path.join(sidecarPath, 'summary.md'),
  };
}

export function findSidecarRoot(startDir = process.cwd()): string | null {
  let current = path.resolve(startDir);
  while (true) {
    if (fs.existsSync(path.join(current, SIDECAR_DIR))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}
