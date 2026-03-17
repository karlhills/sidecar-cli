import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { gt as semverGt } from 'semver';

export type ReleaseChannel = 'latest' | 'beta' | 'rc';

type UpdateCache = {
  lastCheckedAt: string;
  byChannel: Partial<Record<ReleaseChannel, string>>;
};

const CHECK_INTERVAL_MS = 12 * 60 * 60 * 1000;

function getCacheFilePath(): string {
  return path.join(os.homedir(), '.sidecar-cli', 'update-check.json');
}

function loadCache(): UpdateCache | null {
  const file = getCacheFilePath();
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as UpdateCache;
  } catch {
    return null;
  }
}

function saveCache(cache: UpdateCache): void {
  const file = getCacheFilePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(cache));
}

export function detectReleaseChannel(version: string): ReleaseChannel {
  if (version.includes('-beta.')) return 'beta';
  if (version.includes('-rc.')) return 'rc';
  return 'latest';
}

function shouldCheckNow(cache: UpdateCache | null): boolean {
  if (!cache?.lastCheckedAt) return true;
  const last = Date.parse(cache.lastCheckedAt);
  if (Number.isNaN(last)) return true;
  return Date.now() - last >= CHECK_INTERVAL_MS;
}

function fetchDistTags(pkgName: string): Record<string, string> | null {
  try {
    const raw = execFileSync('npm', ['view', pkgName, 'dist-tags', '--json'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 2000,
    }).trim();
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, string>;
    return typeof parsed === 'object' && parsed ? parsed : null;
  } catch {
    return null;
  }
}

export function getUpdateNotice(options: {
  packageName: string;
  currentVersion: string;
  skip?: boolean;
}): { latestVersion: string; channel: ReleaseChannel } | null {
  if (options.skip || process.env.SIDECAR_NO_UPDATE_CHECK === '1') return null;

  const channel = detectReleaseChannel(options.currentVersion);
  const cache = loadCache();

  if (!shouldCheckNow(cache)) {
    const cachedVersion = cache?.byChannel?.[channel];
    if (!cachedVersion) return null;
    return semverGt(cachedVersion, options.currentVersion) ? { latestVersion: cachedVersion, channel } : null;
  }

  const tags = fetchDistTags(options.packageName);
  if (!tags) return null;

  const latestVersion = tags[channel];
  if (!latestVersion) return null;

  saveCache({
    lastCheckedAt: new Date().toISOString(),
    byChannel: {
      ...(cache?.byChannel ?? {}),
      [channel]: latestVersion,
    },
  });

  return semverGt(latestVersion, options.currentVersion) ? { latestVersion, channel } : null;
}
