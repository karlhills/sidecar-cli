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

## Packaging and formula scripts

- `scripts/create-release-tarball.mjs`
- `scripts/generate-homebrew-formula.mjs`
- `templates/homebrew/sidecar.rb.template`
