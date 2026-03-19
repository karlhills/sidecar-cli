import fs from 'node:fs';
import { getSidecarPaths } from '../lib/paths.js';
import type { RunnerType } from '../runs/run-record.js';

export type AgentRole = 'planner' | 'builder-ui' | 'builder-app' | 'reviewer' | 'tester';

export interface RunnerPreferences {
  default_runner: RunnerType;
  preferred_runners: RunnerType[];
  default_agent_role: AgentRole;
}

const DEFAULTS: RunnerPreferences = {
  default_runner: 'codex',
  preferred_runners: ['codex', 'claude'],
  default_agent_role: 'builder-app',
};

export function loadRunnerPreferences(rootPath: string): RunnerPreferences {
  const prefsPath = getSidecarPaths(rootPath).preferencesPath;
  if (!fs.existsSync(prefsPath)) return DEFAULTS;

  try {
    const raw = JSON.parse(fs.readFileSync(prefsPath, 'utf8')) as {
      runner?: {
        defaultRunner?: unknown;
        preferredRunners?: unknown;
        defaultAgentRole?: unknown;
      };
    };

    const defaultRunner = raw.runner?.defaultRunner;
    const preferredRunners = raw.runner?.preferredRunners;
    const defaultAgentRole = raw.runner?.defaultAgentRole;

    return {
      default_runner: defaultRunner === 'codex' || defaultRunner === 'claude' ? defaultRunner : DEFAULTS.default_runner,
      preferred_runners:
        Array.isArray(preferredRunners) && preferredRunners.every((r) => r === 'codex' || r === 'claude')
          ? (preferredRunners as RunnerType[])
          : DEFAULTS.preferred_runners,
      default_agent_role: (() => {
        if (defaultAgentRole === 'builder') return 'builder-app';
        if (
          defaultAgentRole === 'planner' ||
          defaultAgentRole === 'builder-ui' ||
          defaultAgentRole === 'builder-app' ||
          defaultAgentRole === 'reviewer' ||
          defaultAgentRole === 'tester'
        ) {
          return defaultAgentRole;
        }
        return DEFAULTS.default_agent_role;
      })(),
    };
  } catch {
    return DEFAULTS;
  }
}
