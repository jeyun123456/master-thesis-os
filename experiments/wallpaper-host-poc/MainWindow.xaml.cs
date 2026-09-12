using Microsoft.Web.WebView2.Core;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Interop;

namespace WallpaperHostPoc;

public partial class MainWindow : Window
{
    private const int InteractiveHotkeyId = 0x4D54;

    private static readonly Uri ProductionUri =
        new("https://master-thesis-os.vercel.app/");

    private readonly bool _wallpaperRequested;
    private readonly bool _phase2Only;

    private WallpaperAttachment? _wallpaperAttachment;
    private NativeImeFocusBridge? _nativeImeFocusBridge;
    private HwndSource? _hwndSource;
    private nint _hostHwnd;
    private bool _hotkeyRegistered;
    private int _hotkeyRegistrationError;

    public MainWindow()
    {
        InitializeComponent();

        var args = Environment.GetCommandLineArgs();

        _wallpaperRequested = args.Any(arg => string.Equals(
            arg,
            "--wallpaper",
            StringComparison.OrdinalIgnoreCase));

        _phase2Only = args.Any(arg => string.Equals(
            arg,
            "--phase2-only",
            StringComparison.OrdinalIgnoreCase));

        if (_wallpaperRequested)
        {
            // Wallpaper startup itself must not steal focus.
            ShowActivated = false;
            ShowInTaskbar = false;
            WindowStyle = WindowStyle.None;
            ResizeMode = ResizeMode.NoResize;
        }

        SourceInitialized += MainWindow_SourceInitialized;
        Loaded += MainWindow_Loaded;
        Closed += MainWindow_Closed;
    }

    private void MainWindow_SourceInitialized(object? sender, EventArgs e)
    {
        SourceInitialized -= MainWindow_SourceInitialized;

        if (!_wallpaperRequested)
        {
            return;
        }

        _hostHwnd = new WindowInteropHelper(this).Handle;
        _hwndSource = HwndSource.FromHwnd(_hostHwnd);
        _hwndSource?.AddHook(WndProc);

        _hotkeyRegistered = NativeMethods.RegisterHotKey(
            _hostHwnd,
            InteractiveHotkeyId,
            NativeMethods.MOD_CONTROL | NativeMethods.MOD_ALT,
            NativeMethods.VK_W);

        if (!_hotkeyRegistered)
        {
            _hotkeyRegistrationError = Marshal.GetLastWin32Error();
        }

        _wallpaperAttachment = WallpaperAttachment.ForWindow(this);

        if (_wallpaperAttachment.TryAttach(out var status))
        {
            Title = _phase2Only
                ? "Master Thesis OS - Phase 2 Wallpaper"
                : "Master Thesis OS - Phase 3 Wallpaper";

            if (!_hotkeyRegistered)
            {
                MessageBox.Show(
                    $"Wallpaper mode is active, but Ctrl+Alt+W could not be registered. " +
                    $"Win32 error: {_hotkeyRegistrationError}.",
                    "Interactive hotkey unavailable",
                    MessageBoxButton.OK,
                    MessageBoxImage.Warning);
            }

            return;
        }

        // Fail safe: unknown shell layout => ordinary WPF window.
        ShowActivated = true;
        ShowInTaskbar = true;
        WindowStyle = WindowStyle.SingleBorderWindow;
        ResizeMode = ResizeMode.CanResize;

        Title = "Master Thesis OS - Wallpaper attachment failed";
        MessageBox.Show(
            status,
            "Wallpaper attachment was not applied",
            MessageBoxButton.OK,
            MessageBoxImage.Warning);
    }

    private async void MainWindow_Loaded(object sender, RoutedEventArgs e)
    {
        Loaded -= MainWindow_Loaded;

        try
        {
            await Browser.EnsureCoreWebView2Async();

            // Preserve the native Windows/WebView2 input path.
            Browser.CoreWebView2.Settings.AreDefaultContextMenusEnabled = true;
            Browser.CoreWebView2.Settings.AreDevToolsEnabled = true;
            Browser.CoreWebView2.Settings.IsStatusBarEnabled = true;
            Browser.CoreWebView2.Settings.IsZoomControlEnabled = true;

            Browser.CoreWebView2.NavigationCompleted += CoreWebView2_NavigationCompleted;

            if (_wallpaperRequested)
            {
                Browser.CoreWebView2Controller.NotifyParentWindowPositionChanged();
            }

            // Phase 3 is enabled by default in wallpaper mode.
            // Use --phase2-only for an A/B baseline with no focus bridge.
            if (_wallpaperRequested && !_phase2Only)
            {
                var hwnd = new WindowInteropHelper(this).Handle;

                _nativeImeFocusBridge = new NativeImeFocusBridge(
                    this,
                    Browser,
                    hwnd);

                await _nativeImeFocusBridge.InstallAsync();
                _nativeImeFocusBridge.NotifyWallpaperParentReady();
            }

            Browser.CoreWebView2.Navigate(ProductionUri.AbsoluteUri);

            // Only the ordinary Phase 1 window gets startup focus.
            if (!_wallpaperRequested)
            {
                Browser.Focus();
            }
        }
        catch (WebView2RuntimeNotFoundException ex)
        {
            MessageBox.Show(
                "Microsoft Edge WebView2 Runtime was not found.\n\n" +
                ex.Message,
                "WebView2 Runtime Required",
                MessageBoxButton.OK,
                MessageBoxImage.Error);

            Title = "Master Thesis OS - WebView2 Runtime Missing";
        }
        catch (Exception ex)
        {
            MessageBox.Show(
                ex.ToString(),
                "Wallpaper Host PoC startup failed",
                MessageBoxButton.OK,
                MessageBoxImage.Error);

            Title = "Master Thesis OS - Startup Failed";
        }
    }

    private nint WndProc(
        nint hwnd,
        int msg,
        nint wParam,
        nint lParam,
        ref bool handled)
    {
        if (msg == NativeMethods.WM_HOTKEY && wParam.ToInt32() == InteractiveHotkeyId)
        {
            handled = true;
            ToggleInteractiveMode();
        }

        return nint.Zero;
    }

    private void ToggleInteractiveMode()
    {
        if (_wallpaperAttachment is null)
        {
            return;
        }

        if (_wallpaperAttachment.IsAttached)
        {
            if (!_wallpaperAttachment.TryEnterInteractiveMode(out var status))
            {
                MessageBox.Show(
                    status,
                    "Could not enter interactive mode",
                    MessageBoxButton.OK,
                    MessageBoxImage.Warning);
                return;
            }

            if (Browser.CoreWebView2 is not null)
            {
                Browser.CoreWebView2Controller.NotifyParentWindowPositionChanged();
            }

            _ = NativeMethods.SetForegroundWindow(_hostHwnd);
            Activate();
            Browser.Focus();

            if (Browser.CoreWebView2 is not null)
            {
                Browser.CoreWebView2Controller.MoveFocus(
                    CoreWebView2MoveFocusReason.Programmatic);
            }

            Title = "Master Thesis OS - Interactive mode (Ctrl+Alt+W to return)";
            return;
        }

        if (!_wallpaperAttachment.TryAttach(out var attachStatus))
        {
            MessageBox.Show(
                attachStatus,
                "Could not return to wallpaper mode",
                MessageBoxButton.OK,
                MessageBoxImage.Warning);
            return;
        }

        if (Browser.CoreWebView2 is not null)
        {
            Browser.CoreWebView2Controller.NotifyParentWindowPositionChanged();
        }

        var progman = NativeMethods.FindWindow("Progman", null);
        if (progman != nint.Zero)
        {
            _ = NativeMethods.SetForegroundWindow(progman);
        }

        Title = _phase2Only
            ? "Master Thesis OS - Phase 2 Wallpaper"
            : "Master Thesis OS - Phase 3 Wallpaper + native IME focus bridge";
    }

    private void MainWindow_Closed(object? sender, EventArgs e)
    {
        if (_hotkeyRegistered && _hostHwnd != nint.Zero)
        {
            _ = NativeMethods.UnregisterHotKey(_hostHwnd, InteractiveHotkeyId);
        }

        _hwndSource?.RemoveHook(WndProc);
    }

    private void CoreWebView2_NavigationCompleted(
        object? sender,
        CoreWebView2NavigationCompletedEventArgs e)
    {
        if (!e.IsSuccess)
        {
            Title = $"Master Thesis OS - Navigation failed ({e.WebErrorStatus})";
            return;
        }

        if (!_wallpaperRequested)
        {
            Title = "Master Thesis OS - Phase 1";
            return;
        }

        Title = _phase2Only
            ? "Master Thesis OS - Phase 2 Wallpaper"
            : "Master Thesis OS - Phase 3 Wallpaper + native IME focus bridge";
    }
}
