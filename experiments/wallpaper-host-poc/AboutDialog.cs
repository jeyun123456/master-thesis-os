using Forms = System.Windows.Forms;

namespace WallpaperHostPoc;

internal static class AboutDialog
{
    internal static void Show(
        bool wallpaperMode,
        string displayDeviceName,
        bool autoReturnEnabled,
        bool clickToInteractEnabled,
        bool startupEnabled)
    {
        var mode = wallpaperMode ? "Wallpaper" : "Interactive";
        var installed = InstallLayout.IsRunningInstalledCopy ? "Yes" : "No (development build)";
        var executable = Environment.ProcessPath ?? "Unknown";

        var message =
            $"{BuildInfo.ProductName}\n" +
            $"Version {BuildInfo.Version}\n\n" +
            $"Mode: {mode}\n" +
            $"Display: {displayDeviceName}\n" +
            $"Auto-return: {(autoReturnEnabled ? "On" : "Off")}\n" +
            $"Click-to-interact: {(clickToInteractEnabled ? "On (experimental)" : "Off")}\n" +
            $"Start with Windows: {(startupEnabled ? "On" : "Off")}\n" +
            $"Installed copy: {installed}\n\n" +
            $"Hotkey: Ctrl+Alt+W\n" +
            $"Esc: return to wallpaper\n\n" +
            $"Executable:\n{executable}";

        Forms.MessageBox.Show(
            message,
            BuildInfo.ProductName,
            Forms.MessageBoxButtons.OK,
            Forms.MessageBoxIcon.Information);
    }
}
