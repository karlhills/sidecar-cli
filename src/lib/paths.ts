import fs from 'node:fs';
import path from 'node:path';

export const SIDECAR_DIR = '.sidecar';

export interface SidecarPaths {
  rootPath: string;
  sidecarPath: string;
  tasksPath: string;
  runsPath: string;
  promptsPath: string;
  rootAgentsPath: string;
  rootClaudePath: string;
  dbPath: string;
  configPath: string;
  preferencesPath: string;
  agentsPath: string;
  summaryPath: string;
}

export function getSidecarPaths(rootPath: string): SidecarPaths {
  const sidecarPath = path.join(rootPath, SIDECAR_DIR);
  return {
    rootPath,
    sidecarPath,
    tasksPath: path.join(sidecarPath, 'tasks'),
    runsPath: path.join(sidecarPath, 'runs'),
    promptsPath: path.join(sidecarPath, 'prompts'),
    rootAgentsPath: path.join(rootPath, 'AGENTS.md'),
    rootClaudePath: path.join(rootPath, 'CLAUDE.md'),
    dbPath: path.join(sidecarPath, 'sidecar.db'),
    configPath: path.join(sidecarPath, 'config.json'),
    preferencesPath: path.join(sidecarPath, 'preferences.json'),
    agentsPath: path.join(sidecarPath, 'AGENTS.md'),
    summaryPath: path.join(sidecarPath, 'summary.md'),
  };
}

export function findSidecarRoot(startDir = process.cwd()): string | null {
  let current = path.resolve(startDir);
  while (true) {
    const candidate = path.join(current, SIDECAR_DIR);
    if (fs.existsSync(candidate)) {
      const stat = fs.lstatSync(candidate);
      if (stat.isDirectory() && !stat.isSymbolicLink()) return current;
    }
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}
