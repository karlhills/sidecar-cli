#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const root = process.cwd();
const pkgPath = path.join(root, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

const version = process.env.RELEASE_VERSION || pkg.version;
const versionLabel = version.startsWith('v') ? version : `v${version}`;

const distDir = path.join(root, 'dist');
if (!fs.existsSync(distDir)) {
  console.error('dist/ does not exist. Run build before packaging.');
  process.exit(1);
}

const outDir = path.join(root, 'release-artifacts');
const stageDir = path.join(outDir, `sidecar-${versionLabel}`);
fs.rmSync(stageDir, { recursive: true, force: true });
fs.mkdirSync(stageDir, { recursive: true });

fs.cpSync(distDir, path.join(stageDir, 'dist'), { recursive: true });
fs.copyFileSync(path.join(root, 'package.json'), path.join(stageDir, 'package.json'));
if (fs.existsSync(path.join(root, 'README.md'))) {
  fs.copyFileSync(path.join(root, 'README.md'), path.join(stageDir, 'README.md'));
}
if (fs.existsSync(path.join(root, 'LICENSE'))) {
  fs.copyFileSync(path.join(root, 'LICENSE'), path.join(stageDir, 'LICENSE'));
}

const tarballName = `sidecar-${versionLabel}.tar.gz`;
const tarballPath = path.join(outDir, tarballName);
fs.mkdirSync(outDir, { recursive: true });
if (fs.existsSync(tarballPath)) fs.rmSync(tarballPath);

execSync(`tar -czf ${JSON.stringify(tarballPath)} -C ${JSON.stringify(outDir)} ${JSON.stringify(path.basename(stageDir))}`);

console.log(JSON.stringify({ tarballPath, tarballName, version: versionLabel }, null, 2));
