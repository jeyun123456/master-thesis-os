using Microsoft.Win32;

namespace WallpaperHostPoc;

internal static class StartupManager
{
    private const string RunKeyPath = @"Software\Microsoft\Windows\CurrentVersion\Run";
    private const string ValueName = "MasterThesisOSWallpaperHost";

    internal static bool IsEnabled()
    {
        using var key = Registry.CurrentUser.OpenSubKey(RunKeyPath, writable: false);
        var current = key?.GetValue(ValueName) as string;
        return string.Equals(current, BuildCommand(), StringComparison.OrdinalIgnoreCase);
    }

    internal static void SetEnabled(bool enabled)
    {
        using var key = Registry.CurrentUser.CreateSubKey(RunKeyPath, writable: true)
            ?? throw new InvalidOperationException("Could not open the current-user Run registry key.");

        if (enabled)
        {
            key.SetValue(ValueName, BuildCommand(), RegistryValueKind.String);
            return;
        }

        key.DeleteValue(ValueName, throwOnMissingValue: false);
    }

    internal static string BuildCommand()
    {
        return $"\"{InstallLayout.PreferredExecutablePath}\" --wallpaper";
    }
}
