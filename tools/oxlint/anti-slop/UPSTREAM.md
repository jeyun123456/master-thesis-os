# Vendored anti-slop Oxlint plugin

## Source

- Repository: [dmmulroy/anti-slop](https://github.com/dmmulroy/anti-slop), delivered as the assets of the `install-anti-slop` skill.
- Obtained by running the skill's `scripts/install.mjs` from this repository on 2026-10-09.
- Pinned skill record: the Chocomint Lab vault's `skills-lock.json` lists `install-anti-slop` from `dmmulroy/anti-slop` (`skills/install-anti-slop/SKILL.md`, `computedHash` `d92d8dbdf1bd96e11ee33945dca76306179a7c415e7339769084b2c211c6897c`).
- Upstream commit: **unknown**. The bundle carries no commit identifier, and the lock hash identifies the skill snapshot, not a git revision.
- Integrity: this directory is byte-identical (line endings normalized) to the skill's `assets/anti-slop` and to the copy in the vault's `.agents/skills/install-anti-slop/assets/anti-slop`: 38 files, content-tree digest `89c996cf81f0ed18` (SHA-256 over sorted `path sha256` lines, first 16 hex characters).
- Vendored ESLint Stylistic rule and its license: see `vendor/eslint-stylistic/UPSTREAM.md` and `LICENSE`.

## Installed paths

- Generic plugin: `tools/oxlint/anti-slop/index.ts`, registered in `.oxlintrc.json` as `anti-slop`.
- Opt-in Effect plugin: `tools/oxlint/anti-slop/effect/index.ts`, present but **not registered**, because this project has no direct `effect` dependency.
- Runtime packages: `oxlint` and `@oxlint/plugins`, both pinned to exactly `1.87.0` in `devDependencies`.

## Deviations from the bundle

None to the plugin files. Project-level changes made around it:

- `.oxlintrc.json` is new: it ignores installed agent tooling and this vendored directory and enables all generic rules at `error`.
- `tsconfig.json` excludes `tools/oxlint/anti-slop`, because the plugin imports `.ts` paths directly and `tsc --noEmit` would otherwise fail on it.
