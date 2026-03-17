#!/usr/bin/env node
import { execSync } from 'node:child_process';

const args = process.argv.slice(2);

function getArg(name) {
  const idx = args.indexOf(name);
  return idx >= 0 ? args[idx + 1] : undefined;
}

function run(cmd) {
  execSync(cmd, { stdio: 'inherit' });
}

function read(cmd) {
  return execSync(cmd, { encoding: 'utf8' }).trim();
}

const channel = getArg('--channel');
const baseVersion = getArg('--version');
const pre = getArg('--pre');

if (!channel || !['stable', 'beta', 'rc'].includes(channel)) {
  console.error('Missing/invalid --channel. Use stable|beta|rc.');
  process.exit(1);
}

if (!baseVersion || !/^\d+\.\d+\.\d+$/.test(baseVersion)) {
  console.error('Missing/invalid --version. Use semantic base version like 1.2.3.');
  process.exit(1);
}

if ((channel === 'beta' || channel === 'rc') && (!pre || !/^\d+$/.test(pre))) {
  console.error('--pre is required for beta/rc and must be a positive integer.');
  process.exit(1);
}

if (channel === 'stable' && pre) {
  console.error('--pre is not used for stable releases.');
  process.exit(1);
}

const version =
  channel === 'stable' ? baseVersion : `${baseVersion}-${channel}.${pre}`;
const tag = `v${version}`;

const gitStatus = read('git status --porcelain');
if (gitStatus) {
  console.error('Working tree is not clean. Commit/stash changes before cutting a release.');
  process.exit(1);
}

const currentBranch = read('git rev-parse --abbrev-ref HEAD');
if (currentBranch !== 'main') {
  console.error(`Current branch is ${currentBranch}. Switch to main before cutting a release.`);
  process.exit(1);
}

const existingTag = read(`git tag -l ${tag}`);
if (existingTag === tag) {
  console.error(`Tag already exists: ${tag}`);
  process.exit(1);
}

const existingRemoteTag = read(`git ls-remote --tags origin refs/tags/${tag}`);
if (existingRemoteTag) {
  console.error(`Remote already has tag: ${tag}`);
  process.exit(1);
}

console.log(`Cutting ${channel} release ${version} (${tag})`);

run(`npm version ${version} --no-git-tag-version`);
run('git add package.json package-lock.json');
run(`git commit -m "release: ${version}"`);
run(`npm run release_check -- --tag ${tag}`);
run(`git tag ${tag}`);
run('git push origin main --tags');

console.log('Release tag pushed. GitHub Actions release workflow should now run.');
