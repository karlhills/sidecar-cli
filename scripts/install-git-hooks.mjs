#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const hooksDir = path.join(root, '.git', 'hooks');
const hookPath = path.join(hooksDir, 'pre-commit');
const force = process.argv.includes('--force');

if (!fs.existsSync(path.join(root, '.git'))) {
  console.error('No .git directory found. Run from repository root.');
  process.exit(1);
}

fs.mkdirSync(hooksDir, { recursive: true });

const script = `#!/usr/bin/env sh
# Sidecar guard hook (blocks commit for staged non-doc code changes without worklog + summary refresh)
if command -v npm >/dev/null 2>&1; then
  npm run -s sidecar:reminder -- --staged --enforce
fi
`;

if (fs.existsSync(hookPath)) {
  const existing = fs.readFileSync(hookPath, 'utf8');
  const hasSidecarHook = existing.includes('sidecar:reminder');
  if (!hasSidecarHook && !force) {
    console.error('Existing .git/hooks/pre-commit found. Re-run with --force to overwrite.');
    process.exit(1);
  }
  if (hasSidecarHook && !force) {
    console.log('pre-commit hook already contains Sidecar reminder.');
    process.exit(0);
  }
}

fs.writeFileSync(hookPath, script, { mode: 0o755 });
fs.chmodSync(hookPath, 0o755);

console.log('Installed git hook: .git/hooks/pre-commit');
console.log('This hook runs: npm run -s sidecar:reminder -- --staged --enforce');
