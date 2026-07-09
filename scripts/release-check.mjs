#!/usr/bin/env node
import fs from 'node:fs';
import { execSync } from 'node:child_process';

const args = process.argv.slice(2);

function usage() {
  console.log('Usage: node scripts/release-check.mjs --tag <vX.Y.Z|vX.Y.Z-beta.N|vX.Y.Z-rc.N>');
}

function getArg(name) {
  const idx = args.indexOf(name);
  return idx >= 0 ? args[idx + 1] : undefined;
}

function read(cmd) {
  return execSync(cmd, { encoding: 'utf8' }).trim();
}

const tag = getArg('--tag') || process.env.RELEASE_TAG;
const explicitBranch = getArg('--branch');
if (!tag) {
  usage();
  process.exit(1);
}

const stableRe = /^v(\d+)\.(\d+)\.(\d+)$/;
const betaRe = /^v(\d+)\.(\d+)\.(\d+)-beta\.(\d+)$/;
const rcRe = /^v(\d+)\.(\d+)\.(\d+)-rc\.(\d+)$/;

let channel = null;
if (stableRe.test(tag)) channel = 'stable';
if (betaRe.test(tag)) channel = 'beta';
if (rcRe.test(tag)) channel = 'rc';

if (!channel) {
  console.error(`Invalid tag format: ${tag}`);
  console.error('Expected: v1.2.3, v1.2.3-beta.1, or v1.2.3-rc.1');
  process.exit(1);
}

const versionFromTag = tag.slice(1);
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const pkgVersion = pkg.version;

if (pkgVersion !== versionFromTag) {
  console.error(`package.json version mismatch: found ${pkgVersion}, expected ${versionFromTag}`);
  process.exit(1);
}

const npmTag = channel === 'stable' ? 'latest' : channel;
const prerelease = channel !== 'stable';
const currentBranch = explicitBranch || read('git rev-parse --abbrev-ref HEAD');

function expectedBranchFor(channelName, version) {
  if (channelName === 'stable') return 'main';
  if (channelName === 'beta') return 'next';
  return `release/${version}`;
}

const expectedBranch = expectedBranchFor(channel, versionFromTag.replace(/-(beta|rc)\.\d+$/, ''));

if (currentBranch !== expectedBranch) {
  console.error(`Branch mismatch for ${channel} release: found ${currentBranch}, expected ${expectedBranch}`);
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  tag,
  channel,
  branch: currentBranch,
  expectedBranch,
  npmTag,
  prerelease,
  packageVersion: pkgVersion
}, null, 2));
