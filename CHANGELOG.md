# Changelog

Product versions are tracked independently. See [`VERSIONING.md`](./VERSIONING.md) for the release policy.

## [Unreleased]

### Changed

- Added Local Bridge token copy/view and config-folder access to the Wallpaper Companion tray, with shared config-path migration and legacy local-config fallback.
- Unified shared/override config precedence across the Companion and Bridge launchers and removed raw config parser details from tray errors.
- Moved Thunderbird mail analysis from browser/API/localStorage catch-up to explicit two-folder synchronization through the local CLI and SQLite, while retaining reviewed Calendar candidate registration and deterministic deduplication.

## [1.3.0] - 2026-09-14

### Added

- Standardized project Results loading from `result.json`, `view.json`, `scalar.csv`, and `matrix.xlsx`.
- Project-aware metric, table, and chart rendering with legacy dashboard fallback.
- Per-view dataset selection, add/delete controls, table transpose, chart type/orientation controls, and explicit axis ranges.
- Automated version consistency check for the web app and Wallpaper Companion.

## [Wallpaper 0.6.1] - 2026-09-13

### Stable

- WorkerW wallpaper integration, selected-display support, click-to-interact, native Korean/Japanese IME path, tray controls, auto-return, recovery, installer, and single-instance activation.
- Published as the existing `v0.6.1` Companion release. That tag and release must not be retargeted.
