using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;
using System.Windows;
using System.Windows.Input;
using System.Windows.Threading;

namespace WallpaperHostPoc;

/// <summary>
/// Phase 3 experiment: when web content reports that a real editable element
/// received DOM focus, restore the native WPF/WebView2 focus path.
///
/// This class never generates text or key events. Korean/Japanese composition
/// remains owned by Windows + WebView2.
/// </summary>
internal sealed class NativeImeFocusBridge
{
    private const string EditableFocusMessage = "mto:editable-focus";
    private const string EditableBlurMessage = "mto:editable-blur";

    private readonly Window _window;
    private readonly WebView2 _browser;
    private readonly nint _hostHwnd;

    private bool _installed;
    private bool _editableFocused;
    private int _focusGeneration;

    internal NativeImeFocusBridge(Window window, WebView2 browser, nint hostHwnd)
    {
        _window = window;
        _browser = browser;
        _hostHwnd = hostHwnd;
    }

    internal async Task InstallAsync()
    {
        if (_installed)
        {
            return;
        }

        if (_browser.CoreWebView2 is null ||
            _browser.CoreWebView2Controller is null)
        {
            throw new InvalidOperationException(
                "WebView2 must be initialized before installing the focus bridge.");
        }

        _browser.CoreWebView2.WebMessageReceived += CoreWebView2_WebMessageReceived;
        _browser.CoreWebView2Controller.GotFocus += CoreWebView2Controller_GotFocus;
        _browser.CoreWebView2Controller.LostFocus += CoreWebView2Controller_LostFocus;

        await _browser.CoreWebView2.AddScriptToExecuteOnDocumentCreatedAsync(
            BuildEditableFocusProbe());

        _installed = true;
    }

    internal void NotifyWallpaperParentReady()
    {
        // WebView2 documents this as the mechanism for notifying the controller
        // when its parent or any ancestor HWND moved.
        _browser.CoreWebView2Controller?.NotifyParentWindowPositionChanged();
    }

    private void CoreWebView2_WebMessageReceived(
        object? sender,
        CoreWebView2WebMessageReceivedEventArgs e)
    {
        string message;

        try
        {
            message = e.TryGetWebMessageAsString();
        }
        catch
        {
            return;
        }

        switch (message)
        {
            case EditableFocusMessage:
                _editableFocused = true;
                RequestNativeEditableFocus();
                break;

            case EditableBlurMessage:
                _editableFocused = false;
                break;
        }
    }

    private void RequestNativeEditableFocus()
    {
        var generation = ++_focusGeneration;

        // Run after the browser finishes the mouse/focus transaction which
        // produced the DOM focusin event. That avoids racing the click itself.
        _window.Dispatcher.BeginInvoke(
            DispatcherPriority.Input,
            new Action(() =>
            {
                if (!_editableFocused || generation != _focusGeneration)
                {
                    return;
                }

                // This request follows a real user click in the WebView. Windows
                // may reject foreground activation depending on shell state; that
                // is fine, because Browser.Focus + MoveFocus remain the primary
                // WebView-native path.
                _ = NativeMethods.SetForegroundWindow(_hostHwnd);
                _ = _window.Activate();

                _ = _browser.Focus();
                _ = Keyboard.Focus(_browser);

                _browser.CoreWebView2Controller?.MoveFocus(
                    CoreWebView2MoveFocusReason.Programmatic);
            }));
    }

    private void CoreWebView2Controller_GotFocus(
        object? sender,
        object e)
    {
        if (_editableFocused)
        {
            _window.Title = "Master Thesis OS - Phase 3 IME focus active";
        }
    }

    private void CoreWebView2Controller_LostFocus(
        object? sender,
        object e)
    {
        if (_editableFocused)
        {
            _window.Title = "Master Thesis OS - Phase 3 IME focus lost";
        }
    }

    private static string BuildEditableFocusProbe() => $$"""
        (() => {
          if (window.__masterThesisOsNativeImeProbeInstalled) {
            return;
          }

          window.__masterThesisOsNativeImeProbeInstalled = true;

          const isEditable = (node) => {
            if (!(node instanceof Element)) {
              return false;
            }

            if (node.matches('textarea:not([disabled])')) {
              return true;
            }

            if (node.matches(
              'input:not([type="hidden"]):not([type="button"]):not([type="submit"]):not([type="reset"]):not([disabled])'
            )) {
              return true;
            }

            return node.matches(
              '[contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"]'
            );
          };

          document.addEventListener('focusin', (event) => {
            if (isEditable(event.target)) {
              chrome.webview.postMessage('{{EditableFocusMessage}}');
            }
          }, true);

          document.addEventListener('focusout', (event) => {
            if (isEditable(event.target)) {
              chrome.webview.postMessage('{{EditableBlurMessage}}');
            }
          }, true);
        })();
        """;
}
