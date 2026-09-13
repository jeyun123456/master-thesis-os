using System.IO;
using System.Text.Json;

namespace WallpaperHostPoc;

internal sealed class WallpaperSettingsData
{
    public string? TargetDisplayDeviceName { get; set; }

    public bool AutoReturnToWallpaper { get; set; } = true;

    public bool ClickToInteractEnabled { get; set; } = true;
}

internal static class WallpaperSettings
{
    private static readonly object Sync = new();

    private static readonly string SettingsDirectory = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "MasterThesisOSWallpaper");

    internal static string SettingsPath { get; } = Path.Combine(
        SettingsDirectory,
        "settings.json");

    internal static WallpaperSettingsData Load()
    {
        lock (Sync)
        {
            try
            {
                return ReadUnsafe();
            }
            catch (JsonException ex)
            {
                AppLog.Error("Could not load wallpaper settings; defaults will be used.", ex);
                QuarantineCorruptSettings();
                return new WallpaperSettingsData();
            }
            catch (Exception ex)
            {
                AppLog.Error("Could not load wallpaper settings; defaults will be used.", ex);
                return new WallpaperSettingsData();
            }
        }
    }

    internal static void SetTargetDisplayDeviceName(string deviceName)
    {
        if (string.IsNullOrWhiteSpace(deviceName))
        {
            throw new ArgumentException("Display device name must not be empty.", nameof(deviceName));
        }

        Update(settings => settings.TargetDisplayDeviceName = deviceName);
    }

    internal static void SetAutoReturnToWallpaper(bool enabled)
    {
        Update(settings => settings.AutoReturnToWallpaper = enabled);
    }

    internal static void SetClickToInteractEnabled(bool enabled)
    {
        Update(settings => settings.ClickToInteractEnabled = enabled);
    }

    private static void Update(Action<WallpaperSettingsData> update)
    {
        lock (Sync)
        {
            Directory.CreateDirectory(SettingsDirectory);

            var settings = LoadUnsafe();
            update(settings);

            var json = JsonSerializer.Serialize(
                settings,
                new JsonSerializerOptions
                {
                    WriteIndented = true,
                });

            var temporaryPath = SettingsPath + ".tmp";
            File.WriteAllText(temporaryPath, json);
            File.Move(temporaryPath, SettingsPath, overwrite: true);
        }
    }

    private static WallpaperSettingsData LoadUnsafe()
    {
        try
        {
            return ReadUnsafe();
        }
        catch (JsonException ex)
        {
            AppLog.Error("Could not read existing wallpaper settings before saving.", ex);
            QuarantineCorruptSettings();
            return new WallpaperSettingsData();
        }
        catch (Exception ex)
        {
            AppLog.Error("Could not read existing wallpaper settings before saving.", ex);
            return new WallpaperSettingsData();
        }
    }

    private static WallpaperSettingsData ReadUnsafe()
    {
        if (!File.Exists(SettingsPath))
        {
            return new WallpaperSettingsData();
        }

        var json = File.ReadAllText(SettingsPath);
        return JsonSerializer.Deserialize<WallpaperSettingsData>(json)
            ?? new WallpaperSettingsData();
    }

    private static void QuarantineCorruptSettings()
    {
        if (!File.Exists(SettingsPath))
        {
            return;
        }

        var backupPath =
            $"{SettingsPath}.corrupt-{DateTime.UtcNow:yyyyMMdd-HHmmssfff}-" +
            $"{Guid.NewGuid():N}.json";

        try
        {
            File.Move(SettingsPath, backupPath);
            AppLog.Warn(
                $"Corrupt wallpaper settings were moved to '{backupPath}'.");
        }
        catch (Exception backupException)
        {
            AppLog.Error(
                "Could not preserve the corrupt wallpaper settings file.",
                backupException);
        }
    }
}
