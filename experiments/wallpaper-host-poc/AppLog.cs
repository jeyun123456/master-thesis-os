using System.Diagnostics;
using System.Text;

namespace WallpaperHostPoc;

internal static class AppLog
{
    private static readonly object Sync = new();
    private static bool _initialized;

    internal static string LogDirectory { get; } = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "MasterThesisOSWallpaper",
        "logs");

    internal static void Initialize()
    {
        lock (Sync)
        {
            if (_initialized)
            {
                return;
            }

            _initialized = true;

            try
            {
                Directory.CreateDirectory(LogDirectory);
            }
            catch
            {
                // Logging must never stop the wallpaper host from starting.
            }

            AppDomain.CurrentDomain.UnhandledException += (_, e) =>
            {
                if (e.ExceptionObject is Exception ex)
                {
                    Error("Unhandled AppDomain exception.", ex);
                }
                else
                {
                    Error($"Unhandled AppDomain exception object: {e.ExceptionObject}");
                }
            };

            TaskScheduler.UnobservedTaskException += (_, e) =>
            {
                Error("Unobserved task exception.", e.Exception);
            };
        }

        Info($"Process started. PID={Environment.ProcessId}, args='{string.Join(' ', Environment.GetCommandLineArgs().Skip(1))}'.");
    }

    internal static void Info(string message) => Write("INFO", message, null);

    internal static void Warn(string message) => Write("WARN", message, null);

    internal static void Error(string message) => Write("ERROR", message, null);

    internal static void Error(string message, Exception exception) =>
        Write("ERROR", message, exception);

    internal static void OpenLogFolder()
    {
        Directory.CreateDirectory(LogDirectory);

        Process.Start(new ProcessStartInfo
        {
            FileName = LogDirectory,
            UseShellExecute = true,
        });
    }

    private static void Write(string level, string message, Exception? exception)
    {
        try
        {
            Directory.CreateDirectory(LogDirectory);

            var builder = new StringBuilder();
            builder.Append(DateTimeOffset.Now.ToString("O"));
            builder.Append(" [");
            builder.Append(level);
            builder.Append("] ");
            builder.Append(message);

            if (exception is not null)
            {
                builder.AppendLine();
                builder.Append(exception);
            }

            builder.AppendLine();

            var path = Path.Combine(
                LogDirectory,
                $"wallpaper-host-{DateTime.Now:yyyy-MM-dd}.log");

            lock (Sync)
            {
                File.AppendAllText(path, builder.ToString(), Encoding.UTF8);
            }
        }
        catch
        {
            // Never fail the host because the log directory is unavailable.
        }
    }
}
