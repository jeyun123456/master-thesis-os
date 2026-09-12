using Drawing = System.Drawing;
using Forms = System.Windows.Forms;

namespace WallpaperHostPoc;

internal sealed class TrayIconController : IDisposable
{
    private readonly Forms.NotifyIcon _notifyIcon;
    private readonly Forms.ToolStripMenuItem _statusItem;
    private readonly Forms.ToolStripMenuItem _interactiveItem;
    private readonly Forms.ToolStripMenuItem _wallpaperItem;
    private readonly Forms.ToolStripMenuItem _startupItem;

    private readonly Func<bool> _isWallpaperMode;
    private readonly Action _enterInteractiveMode;
    private readonly Action _returnToWallpaperMode;
    private readonly Action _refresh;
    private readonly Func<bool> _isStartupEnabled;
    private readonly Action<bool> _setStartupEnabled;
    private readonly Action _exit;

    internal TrayIconController(
        Func<bool> isWallpaperMode,
        Action enterInteractiveMode,
        Action returnToWallpaperMode,
        Action refresh,
        Func<bool> isStartupEnabled,
        Action<bool> setStartupEnabled,
        Action exit)
    {
        _isWallpaperMode = isWallpaperMode;
        _enterInteractiveMode = enterInteractiveMode;
        _returnToWallpaperMode = returnToWallpaperMode;
        _refresh = refresh;
        _isStartupEnabled = isStartupEnabled;
        _setStartupEnabled = setStartupEnabled;
        _exit = exit;

        _statusItem = new Forms.ToolStripMenuItem("Wallpaper mode")
        {
            Enabled = false,
        };

        _interactiveItem = new Forms.ToolStripMenuItem("Enter Interactive mode");
        _interactiveItem.Click += (_, _) => _enterInteractiveMode();

        _wallpaperItem = new Forms.ToolStripMenuItem("Return to Wallpaper");
        _wallpaperItem.Click += (_, _) => _returnToWallpaperMode();

        var refreshItem = new Forms.ToolStripMenuItem("Refresh");
        refreshItem.Click += (_, _) => _refresh();

        _startupItem = new Forms.ToolStripMenuItem("Start with Windows");
        _startupItem.Click += (_, _) => ToggleStartup();

        var logsItem = new Forms.ToolStripMenuItem("Open Logs Folder");
        logsItem.Click += (_, _) => OpenLogs();

        var exitItem = new Forms.ToolStripMenuItem("Exit");
        exitItem.Click += (_, _) => _exit();

        var menu = new Forms.ContextMenuStrip();
        menu.Items.Add(_statusItem);
        menu.Items.Add(new Forms.ToolStripSeparator());
        menu.Items.Add(_interactiveItem);
        menu.Items.Add(_wallpaperItem);
        menu.Items.Add(refreshItem);
        menu.Items.Add(new Forms.ToolStripSeparator());
        menu.Items.Add(_startupItem);
        menu.Items.Add(logsItem);
        menu.Items.Add(new Forms.ToolStripSeparator());
        menu.Items.Add(exitItem);
        menu.Opening += (_, _) => RefreshState();

        _notifyIcon = new Forms.NotifyIcon
        {
            Icon = Drawing.SystemIcons.Application,
            Text = "Master Thesis OS Wallpaper",
            ContextMenuStrip = menu,
            Visible = true,
        };

        _notifyIcon.DoubleClick += (_, _) =>
        {
            if (_isWallpaperMode())
            {
                _enterInteractiveMode();
            }
            else
            {
                _returnToWallpaperMode();
            }
        };

        RefreshState();
    }

    internal void RefreshState()
    {
        var wallpaperMode = _isWallpaperMode();
        _statusItem.Text = wallpaperMode ? "Wallpaper mode" : "Interactive mode";
        _interactiveItem.Enabled = wallpaperMode;
        _wallpaperItem.Enabled = !wallpaperMode;

        try
        {
            _startupItem.Checked = _isStartupEnabled();
        }
        catch
        {
            _startupItem.Checked = false;
        }
    }

    internal void ShowInfo(string title, string text, int timeoutMilliseconds = 2000)
    {
        _notifyIcon.BalloonTipTitle = title;
        _notifyIcon.BalloonTipText = text;
        _notifyIcon.ShowBalloonTip(timeoutMilliseconds);
    }

    private void ToggleStartup()
    {
        try
        {
            var next = !_isStartupEnabled();
            _setStartupEnabled(next);
            _startupItem.Checked = _isStartupEnabled();

            AppLog.Info(next
                ? "Start with Windows enabled."
                : "Start with Windows disabled.");

            ShowInfo(
                "Master Thesis OS Wallpaper",
                next
                    ? "Start with Windows enabled."
                    : "Start with Windows disabled.",
                1500);
        }
        catch (Exception ex)
        {
            AppLog.Error("Startup setting failed.", ex);
            ShowInfo("Startup setting failed", ex.Message, 3000);
        }
    }

    private void OpenLogs()
    {
        try
        {
            AppLog.OpenLogFolder();
        }
        catch (Exception ex)
        {
            AppLog.Error("Could not open the log folder.", ex);
            ShowInfo("Could not open logs", ex.Message, 3000);
        }
    }

    public void Dispose()
    {
        _notifyIcon.Visible = false;
        _notifyIcon.Dispose();
    }
}
