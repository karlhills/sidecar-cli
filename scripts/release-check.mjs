#!/usr/bin/env node
import fs from 'node:fs';

const args = process.argv.slice(2);

function usage() {
  console.log('Usage: node scripts/release-check.mjs --tag <vX.Y.Z|vX.Y.Z-beta.N|vX.Y.Z-rc.N>');
}

function getArg(name) {
  const idx = args.indexOf(name);
  return idx >= 0 ? args[idx + 1] : undefined;
}

const tag = getArg('--tag') || process.env.RELEASE_TAG;
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

console.log(JSON.stringify({
  ok: true,
  tag,
  channel,
  npmTag,
  prerelease,
  packageVersion: pkgVersion
}, null, 2));
