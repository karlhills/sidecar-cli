# Releasing Sidecar

This repository uses a tag-driven GitHub Actions release workflow.

## Version and tag formats

- Stable: `v1.2.3`
- Beta: `v1.2.3-beta.1`
- RC: `v1.2.3-rc.1`

The git tag and `package.json` version must match (without the leading `v`).

Examples:

- tag `v1.2.3` requires `"version": "1.2.3"`
- tag `v1.2.3-beta.1` requires `"version": "1.2.3-beta.1"`

## Branching strategy (recommended)

Use three long-lived lanes:

- `main`: stable production branch
- `next`: beta feature branch
- `release/x.y.z`: RC stabilization branch for a target release

### Responsibilities

- `main`
  - only production-ready code
  - stable tags (`vX.Y.Z`) are cut from `main`
- `next`
  - active feature development
  - beta tags (`vX.Y.Z-beta.N`) are cut from `next`
- `release/x.y.z`
  - cut from `next` when feature-complete for that release
  - accept only stabilization fixes (bugs, docs, polish)
  - RC tags (`vX.Y.Z-rc.N`) are cut from this branch

### Promotion flow

1. Build features on short-lived branches into `next`.
2. Cut `release/x.y.z` from `next` when ready to stabilize.
3. Publish beta from `next` while features are still moving.
4. Publish RC from `release/x.y.z` while hardening.
5. Merge `release/x.y.z` into `main` and tag stable.
6. Merge `main` back into `next` after stable release so branches stay aligned.

### Emergency hotfix flow

If stable needs a break-fix:

1. Create `hotfix/x.y.(z+1)` from `main`.
2. Implement minimal fix and merge to `main`.
3. Tag stable patch release (`vX.Y.(Z+1)`).
4. Cherry-pick or merge the same fix into `next`.
5. If an RC branch is open, apply the fix there too.

Rule: every hotfix merged to `main` must be backported to `next` (and open `release/*` branches) to prevent regressions.

## What the release workflow does

On push of any `v*` tag:

1. installs dependencies
2. builds project
3. runs tests if configured (`npm run test --if-present`)
4. packages release tarball (`sidecar-vX.Y.Z*.tar.gz`)
5. publishes to npm with channel-appropriate dist-tag
6. creates a GitHub Release with generated notes
7. uploads tarball asset to the GitHub Release
8. for stable tags only: updates Homebrew tap formula if configured

## npm publishing behavior

- `v1.2.3` -> `npm publish` (default `latest`)
- `v1.2.3-beta.1` -> `npm publish --tag beta`
- `v1.2.3-rc.1` -> `npm publish --tag rc`

Prereleases are never published as `latest`.

## Homebrew behavior

Homebrew tap updates are **stable-only** in this first implementation.

- stable (`vX.Y.Z`): update tap formula with new version/url/sha
- beta/rc: skipped by design

## Required GitHub configuration

### Secrets

- `NPM_TOKEN`: npm automation token with publish access
- `HOMEBREW_TAP_GITHUB_TOKEN`: token with push access to tap repo (only if Homebrew automation is desired)

### Repository variables

- `HOMEBREW_TAP_REPO`: e.g. `YOUR_GITHUB_NAME/homebrew-sidecar`

If Homebrew variable/secret is missing, release still succeeds and Homebrew update is skipped.

### Environment

- `release` environment (recommended): add required reviewers for manual approval before publish steps run.

## One-command release

Use these shortcuts from a clean branch:

- stable: from `main`
- beta: from `next`
- rc: from `release/x.y.z`

```bash
# stable
npm run release:stable -- --version 1.2.3

# beta
npm run release:beta -- --version 1.2.3 --pre 1

# rc
npm run release:rc -- --version 1.2.3 --pre 1

# dry run preview
npm run release:beta -- --version 1.2.3 --pre 1 --dry-run
```

These commands will:

1. bump package version
2. commit version files
3. run preflight validation
4. create release tag
5. push main + tags

## Preflight check

Before pushing a release tag, validate tag/version:

```bash
npm run release_check -- --tag v1.2.3
```

For beta/rc:

```bash
npm run release_check -- --tag v1.2.3-beta.1
npm run release_check -- --tag v1.2.3-rc.1
```

## Release commands

### Stable

```bash
npm version 1.2.3 --no-git-tag-version
git add package.json package-lock.json
git commit -m "release: 1.2.3"
git tag v1.2.3
git push origin main --tags
```

### Beta

```bash
npm version 1.2.3-beta.1 --no-git-tag-version
git add package.json package-lock.json
git commit -m "release: 1.2.3-beta.1"
git tag v1.2.3-beta.1
git push origin main --tags
```

### RC

```bash
npm version 1.2.3-rc.1 --no-git-tag-version
git add package.json package-lock.json
git commit -m "release: 1.2.3-rc.1"
git tag v1.2.3-rc.1
git push origin main --tags
```

## Workflow files

- `.github/workflows/ci.yml`
- `.github/workflows/release.yml`

Security notes:

- workflows pin third-party actions to commit SHAs
- CI runs with read-only contents permission
- release job uses `environment: release` and scoped write permission

## Packaging and formula scripts

- `scripts/create-release-tarball.mjs`
- `scripts/generate-homebrew-formula.mjs`
- `templates/homebrew/sidecar.rb.template`

## Public repo hygiene: what not to commit

Do not commit:

- any secret tokens (`NPM_TOKEN`, `HOMEBREW_TAP_GITHUB_TOKEN`, `.npmrc` with auth)
- local build/release artifacts (`release-artifacts/`, `*.tgz`)
- local runtime data (`.sidecar/`)
- machine-specific files (`.DS_Store`, editor temp files)

Safe to commit:

- workflow files
- packaging scripts
- formula templates
- release docs
- branching/release policy docs (this file)
