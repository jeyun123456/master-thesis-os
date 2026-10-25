# Versioning and release policy

This repository ships one versioned deliverable, the Master Thesis OS web app. The Windows Wallpaper Companion was removed in web-app `1.4.0`; its history is kept below.

## Canonical version sources

| Deliverable | Current version | Canonical source | Release surface |
| --- | --- | --- | --- |
| Master Thesis OS web app | `1.3.0` | `package.json` → `version` | Vercel deployment and repository release tag `vX.Y.Z` |

The web app reads its displayed version from `package.json`; it must not contain separate hard-coded UI versions.

## Local Bridge runtime

The Local Bridge is no longer packaged by a Companion installer. `local-bridge/Install-StandaloneBridge.ps1` copies the bridge into `%LOCALAPPDATA%\MasterThesisOS\bridge-runtime` and points the per-user Startup shortcut at it. Bridge settings stay in the legacy data folder `%LOCALAPPDATA%\MasterThesisOSWallpaper\bridge\config.json`, which is a compatibility path for existing user data, not a Companion dependency.

Schema and methodology versions are different contracts. For example, `results-view.schema.json` version `1` and exporter schema version `1.1.0` describe data formats, not either product release.

Run the consistency check before every commit that changes a product version:

```powershell
pnpm version:check
```

The check verifies that the package version, the displayed version, and the changelog entry agree.

## Bump rules

- Patch (`X.Y.Z` → `X.Y.Z+1`): bug fixes and documentation-only product maintenance.
- Minor (`X.Y.Z` → `X.Y+1.0`): backward-compatible user-facing features.
- Major (`X.Y.Z` → `X+1.0.0`): incompatible configuration, data, or runtime changes.
- Do not retarget or delete an existing published tag.

The current `1.4.0` web-app release adds the research project Kanban, P0-linked project tasks, milestones, research memos, global search, the AI worker queue, and approval-based AI workflows, and removes the Wallpaper Companion.

## Tags and GitHub Releases

- `vX.Y.Z` is the web-app/repository release tag.
- The existing unprefixed `v0.6.1` tag and release are the historical stable Wallpaper Companion release and remain unchanged.
- Tags are annotated, point to the exact commit released from `main`, and are pushed only after the full verification suite passes.
- Releases are published releases, never draft or prerelease, unless explicitly requested otherwise.

## Branch policy

- `main` is the deployable, releaseable branch.
- Feature branches use `feat/<scope>` or `feature/<scope>` and are pushed before review/merge.
- A feature branch may remain as historical evidence after its commits are merged; it should not be force-updated to a later unrelated state.
- Before merging, verify the intended diff, tests, version check, and clean working tree. Never use reset/clean to hide unrelated user changes.

## Release checklist

1. Update the canonical version source for the changed deliverable.
2. Add a dated entry to `CHANGELOG.md`.
3. Run `pnpm install --frozen-lockfile`, `pnpm version:check`, `pnpm test:web`, `pnpm lint`, `pnpm build`, `pnpm test:bridge`, and `pnpm test:exporter`.
4. Review `git diff`, ensure unrelated changes are unstaged, then commit and push.
5. Create the annotated tag and published GitHub Release at the verified `main` commit.
6. Verify the tag target, release assets/notes, `origin/main`, and a clean working tree.
