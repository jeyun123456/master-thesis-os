# Changelog

See [`VERSIONING.md`](./VERSIONING.md) for the release policy.

## [Unreleased]

## [1.4.0] - 2026-10-25

### Added

- Research project Kanban (기획 → 완료 plus 단계 미확인) with P0-backed next task, remaining tasks and nearest deadline per card, and a full-screen project detail: P0 project tasks, overview, milestones, blockers, questions and memos, files and results. Board filter and scroll are restored on return.
- `services/mtos-agent`: a separate loopback service and SQLite DB on the P0 server for memos, milestones (official deadlines vs internal goals, with history), the AI inbox, approvals, task steps/blockers/recurrence and focus picks, plus a persistent Codex CLI job queue and Gmail collection at 06:00/18:00 Asia/Tokyo for allow-listed senders.
- AI inbox: quick capture with an offline outbox, automatic classification, automatic creation of clear tasks (marked as AI-made and new, undoable), approvals with diff and edit, P0 conflict choice, and history.
- Home: urgent approvals only, AI focus recommendations (1–5) with free 15–60 minute slots, task breakdown with next step, blockers and snooze, recurring tasks with done/skip/defer.
- Approval-gated "Obsidian에 저장" that writes only if the note still matches the reviewed SHA.
- Collapsed global search across P0 tasks, projects, memos, milestones, the inbox and source links.

### Removed

- Removed the Windows Wallpaper Companion (`experiments/wallpaper-host-poc`), the `/wallpaper` and `/companion-diagnostics` pages, the Companion WebView shortcut host (file picker and native icons), Companion packaging checks, and the Companion version check. The historical `v0.6.1` tag and Release are kept.
- The Local Bridge now installs on its own with `local-bridge/Install-StandaloneBridge.ps1`. Its config stays in the legacy `%LOCALAPPDATA%\MasterThesisOSWallpaper\bridge` folder so existing installs keep working.

### Fixed

- Bridge tests: expect API v8 and copy every runtime module in the config-error test.

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
