# Master Thesis OS Android Home Companion PoC

Android home-screen companion proof of concept for **Master Thesis OS**.

Production web app: <https://master-thesis-os.vercel.app>

This experiment is intentionally isolated under `experiments/android-home-poc/` and does not require changes to the existing Next.js application for Phase 1.

## Decision

Phase 1 uses **native Kotlin + Jetpack Glance App Widget**.

Why Glance first:

- it is the current Compose-style API for Android App Widgets;
- the target experience is glanceable home-screen information, not a web browser embedded into a widget;
- widgets still use AppWidget/RemoteViews under the hood, so embedding an interactive WebView directly in the widget is not a viable model;
- a WebView shell adds lifecycle/auth/navigation complexity before it provides Phase 1 value.

A companion Activity/WebView or Custom Tab is deferred to Phase 3. For the current PoC, tapping the widget launches a no-UI trampoline Activity with an explicit Glance action; that Activity immediately forwards the production URL through Android's normal `ACTION_VIEW` handling, which can resolve to the user's browser or installed PWA.

### Glance vs classic AppWidget

Glance is the better Phase 1 default because this widget only needs text/card layout and click actions. It still renders through the Android AppWidget/RemoteViews model, so we keep the normal launcher compatibility model without hand-authoring `RemoteViews`. Fall back to a classic `AppWidgetProvider` + `RemoteViews` only if a later requirement needs low-level RemoteViews behavior that Glance cannot express reliably.

## Phase 1 implemented

The widget displays static mock cards for:

- 오늘 할 일
- 가까운 일정
- 연구 진행 상태
- Master Thesis OS 바로가기

The entire widget is tappable. Glance starts `OpenMasterThesisActivity` explicitly, and that no-UI Activity opens:

`https://master-thesis-os.vercel.app`

No Local Bridge calls are made from Android.

## Project stack

- Android native Kotlin
- Jetpack Glance App Widget `1.2.0` (stable)
- Android Gradle Plugin `8.13.2`
- Kotlin / Compose compiler plugin `2.3.21`
- Gradle `8.13`
- `compileSdk 36`, `targetSdk 36`, `minSdk 23`
- JDK 17

AGP 8.13.2 is intentionally used for this PoC because it is a stable toolchain with Kotlin 2.3 support and avoids coupling the first widget validation to AGP 9 built-in-Kotlin migration details.

## Run

1. Open `experiments/android-home-poc/` in Android Studio.
2. Use JDK 17.
3. Sync Gradle.
4. Run/install the `app` module on a physical Android device or emulator.
5. Long-press the launcher home screen → Widgets → **Master Thesis OS Companion**.
6. Add the widget (recommended initial size: 4 × 4).
7. Tap it and confirm the production web app opens.

### Gradle wrapper note

The binary `gradle-wrapper.jar` is intentionally not stored by the repository-editing path. Before first CLI build, bootstrap the official Gradle 8.13 wrapper JAR and verify its published SHA-256:

```powershell
.\bootstrap-wrapper.ps1
.\gradlew.bat assembleDebug
```

or on macOS/Linux:

```bash
./bootstrap-wrapper.sh
./gradlew assembleDebug
```

The bootstrap scripts fail closed unless the wrapper JAR SHA-256 is `81a82aaea5abcc8ff68b3dfcb58b3c3c429378efd98e7433460610fecd7ae45f`. A local Gradle 8.13 installation can alternatively regenerate the wrapper with `gradle wrapper --gradle-version 8.13`.

## Phase 2 design

See [`docs/phase-2-data-plan.md`](docs/phase-2-data-plan.md).

The important point is that the existing Next.js server already has useful API routes, but background Android access must not be enabled until the production API exposure/auth boundary is explicitly reviewed.

## Phase 3 recommendation

Do not add a WebView shell by default.

Preferred order:

1. keep widget → browser/PWA handoff if it feels fast enough;
2. use Custom Tabs if an app-owned transition is useful while preserving browser cookies/session behavior;
3. use WebView only if Master Thesis OS needs native-app-owned navigation, deep links, or tighter integration that Custom Tabs/PWA cannot provide.

## Live Wallpaper research

See [`docs/live-wallpaper-feasibility.md`](docs/live-wallpaper-feasibility.md).

Short version: Android Live Wallpaper can receive raw touch events, but it is a wallpaper surface rather than a normal focusable View/Activity hierarchy. A full interactive WebView with dependable Korean/Japanese IME is therefore not a realistic first-class architecture. The widget approach is much more practical.

## Deliberately not implemented yet

Phase 1 does **not** add:

- production API calls;
- background refresh / WorkManager;
- multiple widget sizes;
- dark/light variants;
- notifications;
- calendar/task shortcuts;
- companion UI / WebView shell;
- production auth/security changes.
