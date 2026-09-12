namespace WallpaperHostPoc;

internal static class InstallLayout
{
    internal static string RootDirectory { get; } = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "MasterThesisOSWallpaper");

    internal static string AppDirectory { get; } = Path.Combine(
        RootDirectory,
        "app");

    internal static string InstalledExecutablePath { get; } = Path.Combine(
        AppDirectory,
        "WallpaperHostPoc.exe");

    internal static string PreferredExecutablePath
    {
        get
        {
            if (File.Exists(InstalledExecutablePath))
            {
                return InstalledExecutablePath;
            }

            var processPath = Environment.ProcessPath;
            if (string.IsNullOrWhiteSpace(processPath))
            {
                throw new InvalidOperationException(
                    "Could not determine the wallpaper host executable path.");
            }

            return processPath;
        }
    }

    internal static bool IsRunningInstalledCopy
    {
        get
        {
            var processPath = Environment.ProcessPath;
            return !string.IsNullOrWhiteSpace(processPath) &&
                   string.Equals(
                       Path.GetFullPath(processPath),
                       Path.GetFullPath(InstalledExecutablePath),
                       StringComparison.OrdinalIgnoreCase);
        }
    }
}
