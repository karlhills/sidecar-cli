import { execFileSync } from 'node:child_process';

export type ReleaseChannel = 'latest' | 'beta' | 'rc';

export type PublishedChannelStatus = {
  version: string | null;
  publishedAt: string | null;
};

type NpmTimes = Record<string, string>;

function readCommand(
  file: string,
  args: string[],
  options?: { timeout?: number }
): string | null {
  try {
    const raw = execFileSync(file, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: options?.timeout ?? 3000,
    }).trim();
    return raw || null;
  } catch {
    return null;
  }
}

function readJson<T>(file: string, args: string[], options?: { timeout?: number }): T | null {
  const raw = readCommand(file, args, options);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function detectReleaseChannel(version: string): ReleaseChannel {
  if (version.includes('-beta.')) return 'beta';
  if (version.includes('-rc.')) return 'rc';
  return 'latest';
}

export function fetchDistTags(pkgName: string): Record<string, string> | null {
  return readJson<Record<string, string>>('npm', ['view', pkgName, 'dist-tags', '--json']);
}

export function fetchPublishTimes(pkgName: string): NpmTimes | null {
  return readJson<NpmTimes>('npm', ['view', pkgName, 'time', '--json'], { timeout: 5000 });
}

export function fetchPublishedPackageVersion(pkgName: string): string | null {
  const raw = readCommand('npm', ['view', pkgName, 'version', '--json']);
  if (!raw) return null;
  return raw.replace(/^"|"$/g, '');
}

export function getGitReleaseStatus(): {
  currentBranch: string | null;
  headTags: string[];
  nearestTag: string | null;
} {
  const currentBranch = readCommand('git', ['rev-parse', '--abbrev-ref', 'HEAD']);
  const headTagsRaw = readCommand('git', ['tag', '--points-at', 'HEAD']) ?? '';
  const nearestTag = readCommand('git', ['describe', '--tags', '--abbrev=0']);
  return {
    currentBranch,
    headTags: headTagsRaw
      .split('\n')
      .map((tag) => tag.trim())
      .filter(Boolean),
    nearestTag,
  };
}

export function getPublishedChannelStatus(pkgName: string): Record<ReleaseChannel, PublishedChannelStatus> {
  const tags = fetchDistTags(pkgName) ?? {};
  const times = fetchPublishTimes(pkgName) ?? {};
  return {
    latest: {
      version: tags.latest ?? null,
      publishedAt: tags.latest ? times[tags.latest] ?? null : null,
    },
    beta: {
      version: tags.beta ?? null,
      publishedAt: tags.beta ? times[tags.beta] ?? null : null,
    },
    rc: {
      version: tags.rc ?? null,
      publishedAt: tags.rc ? times[tags.rc] ?? null : null,
    },
  };
}
