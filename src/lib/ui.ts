import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { detectReleaseChannel } from './update-check.js';
import { SidecarError } from './errors.js';

const UI_PACKAGE = '@sidecar/ui';
const UI_RUNTIME_DIR = path.join(os.homedir(), '.sidecar', 'ui');

type UiChannel = 'latest' | 'beta' | 'rc';

function ensureRuntimeDir() {
  fs.mkdirSync(UI_RUNTIME_DIR, { recursive: true });
  const runtimePkgPath = path.join(UI_RUNTIME_DIR, 'package.json');
  if (!fs.existsSync(runtimePkgPath)) {
    fs.writeFileSync(
      runtimePkgPath,
      JSON.stringify({ name: 'sidecar-ui-runtime', private: true, version: '0.0.0' }, null, 2)
    );
  }
}

function readInstalledUiVersion(): string | null {
  const p = path.join(UI_RUNTIME_DIR, 'node_modules', '@sidecar', 'ui', 'package.json');
  if (!fs.existsSync(p)) return null;
  try {
    const pkg = JSON.parse(fs.readFileSync(p, 'utf8')) as { version?: string };
    return pkg.version ?? null;
  } catch {
    return null;
  }
}

function major(version: string): number | null {
  const m = version.match(/^(\d+)\./);
  if (!m) return null;
  return Number.parseInt(m[1], 10);
}

function isCompatible(cliVersion: string, uiVersion: string | null): boolean {
  if (!uiVersion) return false;
  const cliMajor = major(cliVersion);
  const uiMajor = major(uiVersion);
  return cliMajor !== null && uiMajor !== null && cliMajor === uiMajor;
}

function npmInstall(spec: string): void {
  execFileSync('npm', ['install', '--no-audit', '--no-fund', spec], {
    cwd: UI_RUNTIME_DIR,
    stdio: 'inherit',
  });
}

function getDesiredTag(cliVersion: string): UiChannel {
  return detectReleaseChannel(cliVersion);
}

export function ensureUiInstalled(options: {
  cliVersion: string;
  reinstall?: boolean;
  onStatus?: (line: string) => void;
}): { installedVersion: string } {
  ensureRuntimeDir();

  const tag = getDesiredTag(options.cliVersion);
  const installed = readInstalledUiVersion();
  const shouldInstall = Boolean(options.reinstall) || !isCompatible(options.cliVersion, installed);

  if (shouldInstall) {
    options.onStatus?.(
      installed
        ? `Updating Sidecar UI (${installed}) for CLI compatibility...`
        : 'Installing Sidecar UI for first use...'
    );
    const spec = `${UI_PACKAGE}@${tag}`;
    try {
      npmInstall(spec);
    } catch {
      const localUiPkg = path.resolve(process.cwd(), 'packages', 'ui');
      if (fs.existsSync(path.join(localUiPkg, 'package.json'))) {
        options.onStatus?.('Falling back to local workspace UI package...');
        npmInstall(localUiPkg);
      } else {
        throw new SidecarError(
          'Failed to install Sidecar UI package. Check npm access/network and retry `sidecar ui --reinstall`.'
        );
      }
    }
  }

  const finalVersion = readInstalledUiVersion();
  if (!finalVersion) {
    throw new SidecarError('Sidecar UI appears missing after install. Retry with `sidecar ui --reinstall`.');
  }
  return { installedVersion: finalVersion };
}

export function launchUiServer(options: {
  projectPath: string;
  port: number;
  openBrowser?: boolean;
}): { url: string; child: ChildProcess } {
  const serverPath = path.join(UI_RUNTIME_DIR, 'node_modules', '@sidecar', 'ui', 'server.js');
  if (!fs.existsSync(serverPath)) {
    throw new SidecarError('Sidecar UI server entry was not found after install.');
  }

  const child = spawn(process.execPath, [serverPath, '--project', options.projectPath, '--port', String(options.port)], {
    stdio: 'inherit',
    env: {
      ...process.env,
      SIDECAR_CLI_JS: process.argv[1] || '',
    },
  });

  const url = `http://localhost:${options.port}`;
  if (options.openBrowser) {
    openBrowser(url);
  }
  return { url, child };
}

export function openBrowser(url: string): void {
  const platform = process.platform;
  if (platform === 'darwin') {
    spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
    return;
  }
  if (platform === 'win32') {
    spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
    return;
  }
  spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
}
