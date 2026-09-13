# Historical Native IME focus bridge

`NativeImeFocusBridge.cs` was an earlier wallpaper-mode experiment. It listened
for editable DOM focus messages and then repeatedly requested WPF/WebView2 focus.
It was never part of the supported input architecture.

The bridge was retired because forcing WPF, browser, and DOM focus after a real
editable click raced the normal Windows input transaction. That could interrupt
native Korean/Japanese IME composition and candidate-window behavior. The
supported implementation therefore keeps the normal top-level WebView2 path:
the host enters Open state, Windows owns keyboard and IME processing, and no
focus polling, repeated `MoveFocus`, or synthetic keyboard input is used.

The local source that accumulated during the experiment is preserved as a text
snapshot in [`NativeImeFocusBridge.cs.txt`](./NativeImeFocusBridge.cs.txt). It
is documentation only and is not compiled.
