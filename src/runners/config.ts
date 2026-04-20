import fs from 'node:fs';
import { getSidecarPaths } from '../lib/paths.js';
import type { RunnerType } from '../runs/run-record.js';

export type AgentRole = 'planner' | 'builder-ui' | 'builder-app' | 'reviewer' | 'tester';

export interface RunnerCommandOverride {
  command?: string;
  args?: string[];
}

export interface RunnerCommandOverrides {
  claude?: RunnerCommandOverride;
  codex?: RunnerCommandOverride;
}

export interface RunnerPreferences {
  default_runner: RunnerType;
  preferred_runners: RunnerType[];
  default_agent_role: AgentRole;
  runner_commands?: RunnerCommandOverrides;
}

export interface PromptPreferences {
  budget_target: number;
  budget_max: number;
}

export interface ReviewPreferences {
  auto_approve_on_all_green: boolean;
}

export const REVIEW_PREFERENCE_DEFAULTS: ReviewPreferences = {
  auto_approve_on_all_green: false,
};

const DEFAULTS: RunnerPreferences = {
  default_runner: 'codex',
  preferred_runners: ['codex', 'claude'],
  default_agent_role: 'builder-app',
};

export const PROMPT_PREFERENCE_DEFAULTS: PromptPreferences = {
  budget_target: 1200,
  budget_max: 1500,
};

// Hard safety bounds. Prevents misconfiguration from producing empty or absurdly large prompts.
export const PROMPT_BUDGET_MIN = 200;
export const PROMPT_BUDGET_CEILING = 20000;

export function loadRunnerPreferences(rootPath: string): RunnerPreferences {
  const prefsPath = getSidecarPaths(rootPath).preferencesPath;
  if (!fs.existsSync(prefsPath)) return DEFAULTS;

  try {
    const raw = JSON.parse(fs.readFileSync(prefsPath, 'utf8')) as {
      runner?: {
        defaultRunner?: unknown;
        preferredRunners?: unknown;
        defaultAgentRole?: unknown;
        runnerCommands?: unknown;
      };
    };

    const defaultRunner = raw.runner?.defaultRunner;
    const preferredRunners = raw.runner?.preferredRunners;
    const defaultAgentRole = raw.runner?.defaultAgentRole;
    const runnerCommands = parseRunnerCommands(raw.runner?.runnerCommands);

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
      ...(runnerCommands ? { runner_commands: runnerCommands } : {}),
    };
  } catch {
    return DEFAULTS;
  }
}

function parseRunnerCommandOverride(raw: unknown): RunnerCommandOverride | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as { command?: unknown; args?: unknown };
  const override: RunnerCommandOverride = {};
  if (typeof r.command === 'string' && r.command.length > 0) override.command = r.command;
  if (Array.isArray(r.args) && r.args.every((a) => typeof a === 'string')) override.args = r.args as string[];
  return override.command || override.args ? override : undefined;
}

function parseRunnerCommands(raw: unknown): RunnerCommandOverrides | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as { claude?: unknown; codex?: unknown };
  const claude = parseRunnerCommandOverride(r.claude);
  const codex = parseRunnerCommandOverride(r.codex);
  if (!claude && !codex) return undefined;
  return {
    ...(claude ? { claude } : {}),
    ...(codex ? { codex } : {}),
  };
}

function clampBudget(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(PROMPT_BUDGET_MIN, Math.min(PROMPT_BUDGET_CEILING, Math.floor(value)));
}

export function loadReviewPreferences(rootPath: string): ReviewPreferences {
  const prefsPath = getSidecarPaths(rootPath).preferencesPath;
  if (!fs.existsSync(prefsPath)) return { ...REVIEW_PREFERENCE_DEFAULTS };

  try {
    const raw = JSON.parse(fs.readFileSync(prefsPath, 'utf8')) as {
      review?: { autoApproveOnAllGreen?: unknown };
    };
    const flag = raw.review?.autoApproveOnAllGreen;
    return {
      auto_approve_on_all_green: flag === true,
    };
  } catch {
    return { ...REVIEW_PREFERENCE_DEFAULTS };
  }
}

export function loadPromptPreferences(rootPath: string): PromptPreferences {
  const prefsPath = getSidecarPaths(rootPath).preferencesPath;
  if (!fs.existsSync(prefsPath)) return { ...PROMPT_PREFERENCE_DEFAULTS };

  try {
    const raw = JSON.parse(fs.readFileSync(prefsPath, 'utf8')) as {
      prompt?: {
        budgetTarget?: unknown;
        budgetMax?: unknown;
      };
    };

    const rawTarget = typeof raw.prompt?.budgetTarget === 'number' ? raw.prompt.budgetTarget : NaN;
    const rawMax = typeof raw.prompt?.budgetMax === 'number' ? raw.prompt.budgetMax : NaN;

    const target = clampBudget(rawTarget, PROMPT_PREFERENCE_DEFAULTS.budget_target);
    let max = clampBudget(rawMax, PROMPT_PREFERENCE_DEFAULTS.budget_max);
    // Max must be >= target; otherwise the safety valve can never trigger correctly.
    if (max < target) max = target;

    return { budget_target: target, budget_max: max };
  } catch {
    return { ...PROMPT_PREFERENCE_DEFAULTS };
  }
}
