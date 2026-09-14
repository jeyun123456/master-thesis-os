using System.Diagnostics;
using System.IO;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace WallpaperHostPoc;

internal static class BridgeConfigStore
{
    private const string ConfigOverrideEnvironmentVariable = "MTO_BRIDGE_CONFIG";

    internal static bool TryReadToken(out string token, out string failureReason)
    {
        token = string.Empty;
        failureReason = "Bridge config.json was not found.";

        if (!TryGetActiveConfigPath(out var configPath, out var selectionError))
        {
            failureReason = selectionError ?? failureReason;
            return false;
        }

        if (!File.Exists(configPath))
        {
            return false;
        }

        try
        {
            var json = File.ReadAllText(configPath);
            var config = JsonSerializer.Deserialize<BridgeConfig>(json);
            if (string.IsNullOrWhiteSpace(config?.Token))
            {
                failureReason = "Bridge config.json does not contain a token.";
                return false;
            }

            if (config.Token.Length < 32 || config.Token.StartsWith("CHANGE-THIS", StringComparison.Ordinal))
            {
                failureReason = "Bridge config.json contains an invalid token.";
                return false;
            }

            token = config.Token;
            return true;
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or JsonException)
        {
            failureReason = "Bridge config.json could not be read.";
            return false;
        }
    }

    internal static void OpenConfigDirectory()
    {
        if (!TryGetActiveConfigPath(out var configPath, out var selectionError))
        {
            if (selectionError is not null)
            {
                throw new InvalidOperationException(selectionError);
            }

            configPath = InstallLayout.BridgeConfigPath;
        }

        var directory = Path.GetDirectoryName(configPath) ?? InstallLayout.BridgeDirectory;

        Directory.CreateDirectory(directory);
        Process.Start(new ProcessStartInfo
        {
            FileName = directory,
            UseShellExecute = true,
        });
    }

    private static bool TryGetActiveConfigPath(out string configPath, out string? failureReason)
    {
        configPath = string.Empty;
        failureReason = null;

        var overridePath = Environment.GetEnvironmentVariable(ConfigOverrideEnvironmentVariable);
        if (!string.IsNullOrWhiteSpace(overridePath))
        {
            if (!TryNormalizePath(overridePath.Trim(), out configPath))
            {
                failureReason = "MTO_BRIDGE_CONFIG is not a valid path.";
                return false;
            }

            return true;
        }

        if (TryNormalizePath(InstallLayout.BridgeConfigPath, out var sharedPath) &&
            PathExists(sharedPath))
        {
            configPath = sharedPath;
            return true;
        }

        foreach (var repositoryPath in GetRepositoryConfigPaths(AppContext.BaseDirectory))
        {
            if (PathExists(repositoryPath))
            {
                configPath = repositoryPath;
                return true;
            }
        }

        foreach (var repositoryPath in GetRepositoryConfigPaths(Environment.CurrentDirectory))
        {
            if (PathExists(repositoryPath))
            {
                configPath = repositoryPath;
                return true;
            }
        }

        return false;
    }

    private static bool PathExists(string path) => File.Exists(path) || Directory.Exists(path);

    private static IEnumerable<string> GetRepositoryConfigPaths(
        string startDirectory)
    {
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var directory = new DirectoryInfo(startDirectory);
        for (var depth = 0; depth < 10 && directory is not null; depth++, directory = directory.Parent)
        {
            var candidate = Path.Combine(directory.FullName, "local-bridge", "config.json");
            if (TryNormalizePath(candidate, out var normalized) && seen.Add(normalized))
            {
                yield return normalized;
            }
        }
    }

    private static bool TryNormalizePath(string path, out string normalized)
    {
        normalized = string.Empty;
        try
        {
            normalized = Path.GetFullPath(Environment.ExpandEnvironmentVariables(path));
            return true;
        }
        catch (Exception ex) when (ex is ArgumentException or IOException or NotSupportedException)
        {
            return false;
        }
    }

    private sealed class BridgeConfig
    {
        [JsonPropertyName("token")]
        public string? Token { get; set; }
    }
}
