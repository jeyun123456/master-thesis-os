using Microsoft.Web.WebView2.Core;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Interop;
using MessageBox = System.Windows.MessageBox;

namespace WallpaperHostPoc;

public partial class MainWindow : Window
{
    private const int InteractiveHotkeyId = 0x4D54;

    private static readonly Uri ProductionUri =
        new("https://master-thesis-os.vercel.app/");

    private readonly bool _wallpaperRequested;
    private WallpaperAttachment? _wallpaperAttachment;
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
            Title = "Master Thesis OS - Wallpaper";

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
            // No DOM focus bridge is installed. The normal top-level WebView2 path
            // is the supported native Korean/Japanese IME path.
            Browser.CoreWebView2.Settings.AreDefaultContextMenusEnabled = true;
            Browser.CoreWebView2.Settings.AreDevToolsEnabled = true;
            Browser.CoreWebView2.Settings.IsStatusBarEnabled = true;
            Browser.CoreWebView2.Settings.IsZoomControlEnabled = true;

            Browser.CoreWebView2.NavigationCompleted += CoreWebView2_NavigationCompleted;

            Browser.CoreWebView2.Navigate(ProductionUri.AbsoluteUri);

            // Only the ordinary top-level window gets startup focus.
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
                "Master Thesis OS Wallpaper Companion startup failed",
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

    private bool EnterInteractiveMode()
    {
        if (_wallpaperAttachment is null)
        {
            return false;
        }

        if (!_wallpaperAttachment.IsAttached)
        {
            return true;
        }

        if (!_wallpaperAttachment.TryEnterInteractiveMode(out var status))
        {
            MessageBox.Show(
                status,
                "Could not enter interactive mode",
                MessageBoxButton.OK,
                MessageBoxImage.Warning);
            return false;
        }

        // Interactive mode uses the normal top-level WebView2 input path.
        // Do not call MoveFocus or install DOM focus probes: repeatedly
        // forcing focus breaks IME composition.
        _ = NativeMethods.SetForegroundWindow(_hostHwnd);
        _ = Activate();
        _ = Browser.Focus();

        Title = "Master Thesis OS - Interactive mode (Ctrl+Alt+W to return)";
        _trayIcon?.RefreshState();
        return true;
    }

    private bool ReturnToWallpaperMode()
    {
        if (_wallpaperAttachment is null)
        {
            return false;
        }

        if (_wallpaperAttachment.IsAttached)
        {
            return true;
        }

        if (!_wallpaperAttachment.TryAttach(out var attachStatus))
        {
            MessageBox.Show(
                attachStatus,
                "Could not return to wallpaper mode",
                MessageBoxButton.OK,
                MessageBoxImage.Warning);
            return false;
        }

        var progman = NativeMethods.FindWindow("Progman", null);
        if (progman != nint.Zero)
        {
            _ = NativeMethods.SetForegroundWindow(progman);
        }

        Title = "Master Thesis OS - Wallpaper";
        _trayIcon?.RefreshState();
        return true;
    }

    private bool ToggleInteractiveMode()
    {
        if (_wallpaperAttachment is null)
        {
            return false;
        }

        return _wallpaperAttachment.IsAttached
            ? EnterInteractiveMode()
            : ReturnToWallpaperMode();
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
            Title = "Master Thesis OS";
            return;
        }

        Title = "Master Thesis OS - Wallpaper";
    }
}
