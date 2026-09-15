using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Net.NetworkInformation;

namespace WallpaperHostPoc;

internal sealed class BridgeProcessManager : IDisposable
{
    private static readonly TimeSpan HealthRequestTimeout = TimeSpan.FromSeconds(1);
    private static readonly TimeSpan StartupTimeout = TimeSpan.FromSeconds(8);
    private static readonly string[] RequiredBridgeFiles =
    [
        "bridge.py",
        "bridge_config.py",
        "bridge_security.py",
        "shortcut_launcher.py",
    ];

    private readonly HttpClient _httpClient = new()
    {
        Timeout = HealthRequestTimeout,
    };
    private readonly CancellationTokenSource _lifetime = new();

    private Process? _bridgeProcess;
    private bool _ownsBridgeProcess;
    private bool _disposed;

    internal async Task StartAsync()
    {
        if (_disposed)
        {
            return;
        }

        AppLog.Initialize();

        if (!BridgeConfigStore.TryReadConfig(out var config, out var configError))
        {
            AppLog.Warn($"Local Bridge auto-start skipped: {configError}");
            return;
        }

        if (await IsHealthyAsync(config.Port, _lifetime.Token))
        {
            AppLog.Info("Local Bridge is already running; reusing the existing process.");
            return;
        }

        if (IsPortOccupied(config.Port))
        {
            AppLog.Warn(
                $"Local Bridge port {config.Port} is occupied but did not pass its health check; " +
                "the companion will not start another bridge.");
            return;
        }

        if (!TryFindBridgeScript(out var scriptPath, out var runtimeError))
        {
            AppLog.Warn($"Local Bridge auto-start skipped: {runtimeError}");
            return;
        }

        var bridgeDirectory = Path.GetDirectoryName(scriptPath);
        if (string.IsNullOrWhiteSpace(bridgeDirectory))
        {
            AppLog.Warn("Local Bridge auto-start skipped: bridge runtime directory is invalid.");
            return;
        }

        try
        {
            var process = Process.Start(CreateStartInfo(
                scriptPath,
                bridgeDirectory,
                config.ConfigPath));

            if (process is null)
            {
                AppLog.Warn("Local Bridge auto-start failed: PowerShell did not start.");
                return;
            }

            _bridgeProcess = process;
            _ownsBridgeProcess = true;
            process.EnableRaisingEvents = true;
            process.OutputDataReceived += BridgeProcess_OutputDataReceived;
            process.ErrorDataReceived += BridgeProcess_ErrorDataReceived;
            process.Exited += BridgeProcess_Exited;
            process.BeginOutputReadLine();
            process.BeginErrorReadLine();

            AppLog.Info($"Starting Local Bridge on 127.0.0.1:{config.Port}.");

            if (await WaitForHealthAsync(process, config.Port, _lifetime.Token))
            {
                AppLog.Info("Local Bridge started and passed the health check.");
                return;
            }

            if (process.HasExited)
            {
                AppLog.Warn($"Local Bridge launcher exited during startup with code {process.ExitCode}.");
            }
            else
            {
                AppLog.Warn("Local Bridge did not pass its health check during startup.");
            }

            StopOwnedProcess();
        }
        catch (Exception ex)
        {
            AppLog.Error("Local Bridge auto-start failed.", ex);
            StopOwnedProcess();
        }
    }

    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _lifetime.Cancel();

        StopOwnedProcess();

        _httpClient.Dispose();
        _lifetime.Dispose();
    }

    private void StopOwnedProcess()
    {
        if (_bridgeProcess is null)
        {
            return;
        }

        var process = _bridgeProcess;
        _bridgeProcess = null;

        process.OutputDataReceived -= BridgeProcess_OutputDataReceived;
        process.ErrorDataReceived -= BridgeProcess_ErrorDataReceived;
        process.Exited -= BridgeProcess_Exited;

        if (_ownsBridgeProcess)
        {
            try
            {
                if (!process.HasExited)
                {
                    process.Kill(entireProcessTree: true);
                    process.WaitForExit(2000);
                }
            }
            catch (InvalidOperationException)
            {
                // The launcher exited between the checks.
            }
            catch (Exception ex)
            {
                AppLog.Warn($"Could not stop the Local Bridge launcher: {ex.Message}");
            }
        }

        process.Dispose();
        _ownsBridgeProcess = false;
    }

    private async Task<bool> WaitForHealthAsync(
        Process process,
        int port,
        CancellationToken cancellationToken)
    {
        var deadline = DateTimeOffset.UtcNow + StartupTimeout;

        while (DateTimeOffset.UtcNow < deadline)
        {
            if (process.HasExited)
            {
                return false;
            }

            if (await IsHealthyAsync(port, cancellationToken))
            {
                return true;
            }

            try
            {
                await Task.Delay(200, cancellationToken);
            }
            catch (OperationCanceledException)
            {
                return false;
            }
        }

        return false;
    }

    private async Task<bool> IsHealthyAsync(
        int port,
        CancellationToken cancellationToken)
    {
        try
        {
            using var response = await _httpClient.GetAsync(
                $"http://127.0.0.1:{port}/health",
                cancellationToken);
            return response.IsSuccessStatusCode;
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            return false;
        }
        catch (HttpRequestException)
        {
            return false;
        }
        catch (TaskCanceledException)
        {
            return false;
        }
    }

    private static bool IsPortOccupied(int port)
    {
        try
        {
            return IPGlobalProperties.GetIPGlobalProperties()
                .GetActiveTcpListeners()
                .Any(endpoint => endpoint.Port == port &&
                    (IPAddress.IsLoopback(endpoint.Address) ||
                     endpoint.Address.Equals(IPAddress.Any) ||
                     endpoint.Address.Equals(IPAddress.IPv6Any)));
        }
        catch (Exception ex) when (ex is NetworkInformationException or InvalidOperationException)
        {
            // If Windows cannot report listeners, do not block the normal start attempt.
            return false;
        }
    }

    private static ProcessStartInfo CreateStartInfo(
        string scriptPath,
        string bridgeDirectory,
        string configPath)
    {
        var startInfo = new ProcessStartInfo
        {
            FileName = "powershell.exe",
            WorkingDirectory = bridgeDirectory,
            UseShellExecute = false,
            CreateNoWindow = true,
            WindowStyle = ProcessWindowStyle.Hidden,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
        };

        startInfo.ArgumentList.Add("-NoLogo");
        startInfo.ArgumentList.Add("-NoProfile");
        startInfo.ArgumentList.Add("-NonInteractive");
        startInfo.ArgumentList.Add("-ExecutionPolicy");
        startInfo.ArgumentList.Add("Bypass");
        startInfo.ArgumentList.Add("-WindowStyle");
        startInfo.ArgumentList.Add("Hidden");
        startInfo.ArgumentList.Add("-File");
        startInfo.ArgumentList.Add(scriptPath);
        startInfo.Environment["MTO_BRIDGE_CONFIG"] = configPath;
        return startInfo;
    }

    private static bool TryFindBridgeScript(
        out string scriptPath,
        out string failureReason)
    {
        scriptPath = string.Empty;
        failureReason = "bridge runtime files were not found.";

        foreach (var candidate in EnumerateBridgeScriptCandidates())
        {
            if (!File.Exists(candidate))
            {
                continue;
            }

            var directory = Path.GetDirectoryName(candidate);
            if (string.IsNullOrWhiteSpace(directory))
            {
                continue;
            }

            var missingFile = RequiredBridgeFiles.FirstOrDefault(fileName =>
                !File.Exists(Path.Combine(directory, fileName)));
            if (missingFile is not null)
            {
                failureReason = $"bridge runtime file is missing: {missingFile}";
                continue;
            }

            scriptPath = candidate;
            return true;
        }

        return false;
    }

    private static IEnumerable<string> EnumerateBridgeScriptCandidates()
    {
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var yieldTargets = new List<string>();

        void AddCandidate(string path)
        {
            try
            {
                if (seen.Add(Path.GetFullPath(path)))
                {
                    yieldTargets.Add(Path.GetFullPath(path));
                }
            }
            catch (Exception ex) when (ex is ArgumentException or IOException or NotSupportedException)
            {
                // Ignore malformed candidate paths.
            }
        }

        AddCandidate(Path.Combine(AppContext.BaseDirectory, "bridge-runtime", "start_bridge.ps1"));
        AddCandidate(Path.Combine(AppContext.BaseDirectory, "local-bridge", "start_bridge.ps1"));

        foreach (var startDirectory in new[] { AppContext.BaseDirectory, Environment.CurrentDirectory })
        {
            DirectoryInfo? directory;
            try
            {
                directory = new DirectoryInfo(startDirectory);
            }
            catch (Exception ex) when (ex is ArgumentException or IOException or NotSupportedException)
            {
                continue;
            }

            for (var depth = 0; depth < 12 && directory is not null; depth++, directory = directory.Parent)
            {
                AddCandidate(Path.Combine(directory.FullName, "local-bridge", "start_bridge.ps1"));
            }
        }

        return yieldTargets;
    }

    private void BridgeProcess_OutputDataReceived(
        object sender,
        DataReceivedEventArgs e)
    {
        if (!string.IsNullOrWhiteSpace(e.Data))
        {
            AppLog.Info($"Local Bridge: {e.Data}");
        }
    }

    private void BridgeProcess_ErrorDataReceived(
        object sender,
        DataReceivedEventArgs e)
    {
        if (!string.IsNullOrWhiteSpace(e.Data))
        {
            AppLog.Warn($"Local Bridge: {e.Data}");
        }
    }

    private void BridgeProcess_Exited(object? sender, EventArgs e)
    {
        if (_disposed || sender is not Process process)
        {
            return;
        }

        try
        {
            AppLog.Warn($"Local Bridge launcher exited with code {process.ExitCode}.");
        }
        catch (InvalidOperationException)
        {
            AppLog.Warn("Local Bridge launcher exited unexpectedly.");
        }
    }
}
