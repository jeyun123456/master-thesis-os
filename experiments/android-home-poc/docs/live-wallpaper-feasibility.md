# Android Live Wallpaper feasibility note

## Conclusion

A full interactive Master Thesis OS web app as an Android Live Wallpaper should **not** be the first implementation target.

`WallpaperService.Engine` renders into a wallpaper surface. It is not a normal Activity/Window containing a View hierarchy, so a `WebView` cannot simply be attached to the wallpaper the way it can inside an Activity. A wallpaper engine can opt into raw touch events, but that does not turn it into a regular focusable application window.

## What is technically possible

A custom live wallpaper could:

- receive touch events through `WallpaperService.Engine.setTouchEventsEnabled(true)`;
- render native graphics or a periodically captured/snapshotted representation of web content to the wallpaper surface;
- implement limited hotspots or gestures.

A much more experimental route could render web content off-screen and copy frames into the wallpaper surface. That adds lifecycle, performance, synchronization, and compatibility complexity and is not equivalent to hosting a normal interactive WebView.

## Why IME/text input is the blocker

Normal WebView text editing relies on a focused app window/View and Android's input-method connection. A wallpaper is behind launcher/app windows and is not designed to become a normal text-editing surface. Raw wallpaper touch callbacks do not provide the regular focus/IME model needed for dependable Korean/Japanese text entry.

Therefore:

- **read-only/animated web-derived wallpaper:** technically possible with custom rendering, but costly;
- **limited touch controls:** possible;
- **full WebView-style interaction:** impractical/unsupported as a normal architecture;
- **reliable Korean/Japanese IME inside the wallpaper:** not a realistic primary target.

For this project, the home-screen widget + app/PWA handoff is the materially better Android UX.

## References

- Android `WallpaperService`: https://developer.android.com/reference/android/service/wallpaper/WallpaperService
- Android `WallpaperService.Engine`: https://developer.android.com/reference/android/service/wallpaper/WallpaperService.Engine
- Android WebView overview: https://developer.android.com/develop/ui/views/layout/webapps
