using Microsoft.Web.WebView2.Core;
using System.Windows;
using System.Windows.Interop;

namespace WallpaperHostPoc;

public partial class MainWindow : Window
{
    private static readonly Uri ProductionUri =
        new("https://master-thesis-os.vercel.app/");

    private readonly bool _wallpaperRequested;
    private readonly bool _phase2Only;

    private WallpaperAttachment? _wallpaperAttachment;
    private NativeImeFocusBridge? _nativeImeFocusBridge;

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
    }

    private void MainWindow_SourceInitialized(object? sender, EventArgs e)
    {
        SourceInitialized -= MainWindow_SourceInitialized;

        if (!_wallpaperRequested)
        {
            return;
        }

        _wallpaperAttachment = WallpaperAttachment.ForWindow(this);

        if (_wallpaperAttachment.TryAttach(out var status))
        {
            Title = _phase2Only
                ? "Master Thesis OS - Phase 2 Wallpaper"
                : "Master Thesis OS - Phase 3 Wallpaper";
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
