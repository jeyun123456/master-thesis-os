using Drawing = System.Drawing;
using Forms = System.Windows.Forms;

namespace WallpaperHostPoc;

internal sealed class TrayIconController : IDisposable
{
    private readonly Forms.NotifyIcon _notifyIcon;
    private readonly Drawing.Icon _brandIcon;
    private readonly Forms.ToolStripMenuItem _statusItem;
    private readonly Forms.ToolStripMenuItem _interactiveItem;
    private readonly Forms.ToolStripMenuItem _wallpaperItem;
    private readonly Forms.ToolStripMenuItem _displayItem;
    private readonly Forms.ToolStripMenuItem _autoReturnItem;
    private readonly Forms.ToolStripMenuItem _clickToInteractItem;
    private readonly Forms.ToolStripMenuItem _startupItem;

    private readonly Func<bool> _isWallpaperMode;
    private readonly Action _enterInteractiveMode;
    private readonly Action _returnToWallpaperMode;
    private readonly Action _refresh;
    private readonly Func<IReadOnlyList<DisplayTarget>> _getDisplays;
    private readonly Func<string> _getSelectedDisplayDeviceName;
    private readonly Action<string> _selectDisplay;
    private readonly Func<bool> _isAutoReturnEnabled;
    private readonly Action<bool> _setAutoReturnEnabled;
    private readonly Func<bool> _isClickToInteractEnabled;
    private readonly Action<bool> _setClickToInteractEnabled;
    private readonly Func<bool> _isStartupEnabled;
    private readonly Action<bool> _setStartupEnabled;
    private readonly Action _exit;

    internal TrayIconController(
        Func<bool> isWallpaperMode,
        Action enterInteractiveMode,
        Action returnToWallpaperMode,
        Action refresh,
        Func<IReadOnlyList<DisplayTarget>> getDisplays,
        Func<string> getSelectedDisplayDeviceName,
        Action<string> selectDisplay,
        Func<bool> isAutoReturnEnabled,
        Action<bool> setAutoReturnEnabled,
        Func<bool> isClickToInteractEnabled,
        Action<bool> setClickToInteractEnabled,
        Func<bool> isStartupEnabled,
        Action<bool> setStartupEnabled,
        Action exit)
    {
        _isWallpaperMode = isWallpaperMode;
        _enterInteractiveMode = enterInteractiveMode;
        _returnToWallpaperMode = returnToWallpaperMode;
        _refresh = refresh;
        _getDisplays = getDisplays;
        _getSelectedDisplayDeviceName = getSelectedDisplayDeviceName;
        _selectDisplay = selectDisplay;
        _isAutoReturnEnabled = isAutoReturnEnabled;
        _setAutoReturnEnabled = setAutoReturnEnabled;
        _isClickToInteractEnabled = isClickToInteractEnabled;
        _setClickToInteractEnabled = setClickToInteractEnabled;
        _isStartupEnabled = isStartupEnabled;
        _setStartupEnabled = setStartupEnabled;
        _exit = exit;

        _statusItem = new Forms.ToolStripMenuItem("Status: Wallpaper")
        {
            Enabled = false,
        };

        _interactiveItem = new Forms.ToolStripMenuItem("Open Master Thesis OS");
        _interactiveItem.Click += (_, _) => _enterInteractiveMode();

        _wallpaperItem = new Forms.ToolStripMenuItem("Send to Wallpaper");
        _wallpaperItem.Click += (_, _) => _returnToWallpaperMode();

        var refreshItem = new Forms.ToolStripMenuItem("Refresh");
        refreshItem.Click += (_, _) => _refresh();

        _displayItem = new Forms.ToolStripMenuItem("Display");

        _autoReturnItem = new Forms.ToolStripMenuItem("Return to wallpaper when inactive");
        _autoReturnItem.Click += (_, _) => ToggleAutoReturn();

        _clickToInteractItem = new Forms.ToolStripMenuItem("Click wallpaper to open");
        _clickToInteractItem.Click += (_, _) => ToggleClickToInteract();

        _startupItem = new Forms.ToolStripMenuItem("Start with Windows");
        _startupItem.Click += (_, _) => ToggleStartup();

        var foldersItem = new Forms.ToolStripMenuItem("Folders");

        var dataFolderItem = new Forms.ToolStripMenuItem("Open Data Folder");
        dataFolderItem.Click += (_, _) => OpenFolder(InstallLayout.OpenDataDirectory, "data folder");
        foldersItem.DropDownItems.Add(dataFolderItem);

        var appFolderItem = new Forms.ToolStripMenuItem("Open App Folder");
        appFolderItem.Click += (_, _) => OpenFolder(InstallLayout.OpenAppDirectory, "app folder");
        foldersItem.DropDownItems.Add(appFolderItem);

        var logsItem = new Forms.ToolStripMenuItem("Open Logs Folder");
        logsItem.Click += (_, _) => OpenFolder(AppLog.OpenLogFolder, "logs folder");
        foldersItem.DropDownItems.Add(logsItem);

        var aboutItem = new Forms.ToolStripMenuItem($"About...  v{BuildInfo.Version}");
        aboutItem.Click += (_, _) => ShowAbout();

        var exitItem = new Forms.ToolStripMenuItem("Exit");
        exitItem.Click += (_, _) => _exit();

        var menu = new Forms.ContextMenuStrip();
        menu.Items.Add(_statusItem);
        menu.Items.Add(new Forms.ToolStripSeparator());
        menu.Items.Add(_interactiveItem);
        menu.Items.Add(_wallpaperItem);
        menu.Items.Add(refreshItem);
        menu.Items.Add(_displayItem);
        menu.Items.Add(_autoReturnItem);
        menu.Items.Add(_clickToInteractItem);
        menu.Items.Add(new Forms.ToolStripSeparator());
        menu.Items.Add(_startupItem);
        menu.Items.Add(foldersItem);
        menu.Items.Add(aboutItem);
        menu.Items.Add(new Forms.ToolStripSeparator());
        menu.Items.Add(exitItem);
        menu.Opening += (_, _) => RefreshState();

        _brandIcon = BrandIcon.CreateIcon();
        _notifyIcon = new Forms.NotifyIcon
        {
            Icon = _brandIcon,
            Text = $"{BuildInfo.ShortProductName} v{BuildInfo.Version}",
            ContextMenuStrip = menu,
            Visible = true,
        };

        // Double-click always means "open". Auto-return / Send to Wallpaper handles closing.
        _notifyIcon.DoubleClick += (_, _) => _enterInteractiveMode();

        RefreshState();
    }

    internal void RefreshState()
    {
        var wallpaperMode = _isWallpaperMode();
        _statusItem.Text = wallpaperMode ? "Status: Wallpaper" : "Status: Open";
        _interactiveItem.Enabled = wallpaperMode;
        _wallpaperItem.Enabled = !wallpaperMode;

        RefreshDisplayMenu();

        try
        {
            _autoReturnItem.Checked = _isAutoReturnEnabled();
        }
        catch
        {
            _autoReturnItem.Checked = false;
        }

        try
        {
            _clickToInteractItem.Checked = _isClickToInteractEnabled();
        }
        catch
        {
            _clickToInteractItem.Checked = false;
        }

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

    private void RefreshDisplayMenu()
    {
        _displayItem.DropDownItems.Clear();

        try
        {
            var displays = _getDisplays();
            var selected = _getSelectedDisplayDeviceName();

            if (displays.Count == 0)
            {
                _displayItem.Enabled = false;
                _displayItem.DropDownItems.Add(new Forms.ToolStripMenuItem("No display detected")
                {
                    Enabled = false,
                });
                return;
            }

            _displayItem.Enabled = true;

            foreach (var display in displays)
            {
                var item = new Forms.ToolStripMenuItem(display.Label)
                {
                    Checked = string.Equals(
                        display.DeviceName,
                        selected,
                        StringComparison.OrdinalIgnoreCase),
                    CheckOnClick = false,
                    Tag = display.DeviceName,
                };

                item.Click += (_, _) =>
                {
                    if (item.Tag is string deviceName)
                    {
                        _selectDisplay(deviceName);
                    }
                };

                _displayItem.DropDownItems.Add(item);
            }
        }
        catch (Exception ex)
        {
            AppLog.Error("Could not populate the display menu.", ex);
            _displayItem.Enabled = false;
            _displayItem.DropDownItems.Add(new Forms.ToolStripMenuItem("Display list unavailable")
            {
                Enabled = false,
            });
        }
    }

    private void ToggleAutoReturn()
    {
        try
        {
            var next = !_isAutoReturnEnabled();
            _setAutoReturnEnabled(next);
            _autoReturnItem.Checked = _isAutoReturnEnabled();

            ShowInfo(
                BuildInfo.ShortProductName,
                next
                    ? "Automatic return to wallpaper is enabled."
                    : "Automatic return to wallpaper is disabled.",
                1500);
        }
        catch (Exception ex)
        {
            AppLog.Error("Auto-return setting failed.", ex);
            ShowInfo("Auto-return setting failed", ex.Message, 3000);
        }
    }

    private void ToggleClickToInteract()
    {
        try
        {
            var next = !_isClickToInteractEnabled();
            _setClickToInteractEnabled(next);
            _clickToInteractItem.Checked = _isClickToInteractEnabled();

            ShowInfo(
                BuildInfo.ShortProductName,
                next
                    ? "Click wallpaper to open is enabled. Empty desktop clicks can open Master Thesis OS."
                    : "Click wallpaper to open is disabled. Use the tray or Ctrl+Alt+W to open Master Thesis OS.",
                2200);
        }
        catch (Exception ex)
        {
            AppLog.Error("Click-to-interact setting failed.", ex);
            ShowInfo("Click-to-interact unavailable", ex.Message, 3500);
        }
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
                BuildInfo.ShortProductName,
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

    private void ShowAbout()
    {
        try
        {
            AboutDialog.Show(
                wallpaperMode: _isWallpaperMode(),
                displayDeviceName: _getSelectedDisplayDeviceName(),
                autoReturnEnabled: _isAutoReturnEnabled(),
                clickToInteractEnabled: _isClickToInteractEnabled(),
                startupEnabled: _isStartupEnabled());
        }
        catch (Exception ex)
        {
            AppLog.Error("Could not show About dialog.", ex);
            ShowInfo("About unavailable", ex.Message, 3000);
        }
    }

    private void OpenFolder(Action opener, string description)
    {
        try
        {
            opener();
        }
        catch (Exception ex)
        {
            AppLog.Error($"Could not open the {description}.", ex);
            ShowInfo($"Could not open {description}", ex.Message, 3000);
        }
    }

    public void Dispose()
    {
        _notifyIcon.Visible = false;
        _notifyIcon.Dispose();
        _brandIcon.Dispose();
    }
}
