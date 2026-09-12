namespace WallpaperHostPoc;

internal static class BuildInfo
{
    internal const string ProductName = "Master Thesis OS Wallpaper";

    internal static string Version =>
        typeof(BuildInfo).Assembly.GetName().Version?.ToString(3) ?? "0.0.0";
}
