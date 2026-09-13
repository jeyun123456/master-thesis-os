using Microsoft.Web.WebView2.Core;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.Text.Json;
using Forms = System.Windows.Forms;

namespace WallpaperHostPoc;

public partial class MainWindow
{
    private const string ShortcutBridgeChannel = "master-thesis-os.shortcuts.v1";
    private bool _shortcutBridgeInstalled;

    protected override void OnContentRendered(EventArgs e)
    {
        base.OnContentRendered(e);
        _ = InstallShortcutNativeBridgeAsync();
    }

    private async Task InstallShortcutNativeBridgeAsync()
    {
        if (_shortcutBridgeInstalled) return;
        try
        {
            await Browser.EnsureCoreWebView2Async();
            if (_shortcutBridgeInstalled) return;
            Browser.CoreWebView2.WebMessageReceived += CoreWebView2_ShortcutWebMessageReceived;
            _shortcutBridgeInstalled = true;
        }
        catch (Exception ex)
        {
            AppLog.Warn($"Shortcut bridge initialization failed: {ex.Message}");
        }
    }

    private void CoreWebView2_ShortcutWebMessageReceived(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        if (!ShortcutNativeBridge.IsAllowedSource(e.Source))
        {
            return;
        }

        string? requestId = null;
        try
        {
            using var document = JsonDocument.Parse(e.WebMessageAsJson);
            var root = document.RootElement;
            if (!root.TryGetProperty("channel", out var channel) || channel.GetString() != ShortcutBridgeChannel)
            {
                return;
            }

            requestId = root.TryGetProperty("requestId", out var requestIdElement)
                ? requestIdElement.GetString()
                : null;
            var action = root.TryGetProperty("action", out var actionElement)
                ? actionElement.GetString()
                : null;

            if (string.IsNullOrWhiteSpace(requestId) || string.IsNullOrWhiteSpace(action))
            {
                return;
            }

            if (action == "pick")
            {
                var kind = root.TryGetProperty("kind", out var kindElement) ? kindElement.GetString() : null;
                var picked = ShortcutNativeBridge.Pick(kind);
                PostShortcutBridgeResponse(requestId, true, null, picked?.Path, picked?.Icon);
                return;
            }

            if (action == "execute")
            {
                if (!root.TryGetProperty("shortcut", out var shortcut))
                {
                    throw new InvalidOperationException("shortcut payload is required");
                }

                ShortcutNativeBridge.Execute(shortcut);
                PostShortcutBridgeResponse(requestId, true, null, null, null);
                return;
            }

            throw new InvalidOperationException("unknown shortcut action");
        }
        catch (Exception ex)
        {
            if (!string.IsNullOrWhiteSpace(requestId))
            {
                PostShortcutBridgeResponse(requestId, false, ex.Message, null, null);
            }
            AppLog.Warn($"Shortcut bridge: {ex.Message}");
        }
    }

    private void PostShortcutBridgeResponse(string requestId, bool ok, string? error, string? path, string? icon)
    {
        var json = JsonSerializer.Serialize(new
        {
            channel = ShortcutBridgeChannel,
            requestId,
            ok,
            error,
            path,
            icon,
        });
        Browser.CoreWebView2.PostWebMessageAsJson(json);
    }
}

internal sealed record ShortcutPickResult(string Path, string? Icon);

internal static class ShortcutNativeBridge
{
    internal static bool IsAllowedSource(string source)
    {
        if (!Uri.TryCreate(source, UriKind.Absolute, out var uri))
        {
            return false;
        }

        if (uri.Scheme == Uri.UriSchemeHttps &&
            string.Equals(uri.Host, "master-thesis-os.vercel.app", StringComparison.OrdinalIgnoreCase))
        {
            return true;
        }

        return uri.Scheme == Uri.UriSchemeHttp && uri.IsLoopback;
    }

    internal static ShortcutPickResult? Pick(string? kind)
    {
        switch (kind)
        {
            case "app":
                using (var dialog = new Forms.OpenFileDialog
                {
                    Title = "프로그램 선택",
                    Filter = "Programs (*.exe)|*.exe|All files (*.*)|*.*",
                    CheckFileExists = true,
                    Multiselect = false,
                })
                {
                    return dialog.ShowDialog() == Forms.DialogResult.OK
                        ? new ShortcutPickResult(dialog.FileName, TryIconDataUrl(dialog.FileName))
                        : null;
                }
            case "file":
                using (var dialog = new Forms.OpenFileDialog
                {
                    Title = "파일 선택",
                    CheckFileExists = true,
                    Multiselect = false,
                })
                {
                    return dialog.ShowDialog() == Forms.DialogResult.OK
                        ? new ShortcutPickResult(dialog.FileName, TryIconDataUrl(dialog.FileName))
                        : null;
                }
            case "folder":
                using (var dialog = new Forms.FolderBrowserDialog
                {
                    Description = "폴더 선택",
                    UseDescriptionForTitle = true,
                    ShowNewFolderButton = true,
                })
                {
                    return dialog.ShowDialog() == Forms.DialogResult.OK
                        ? new ShortcutPickResult(dialog.SelectedPath, null)
                        : null;
                }
            default:
                throw new InvalidOperationException("unsupported picker type");
        }
    }

    internal static void Execute(JsonElement shortcut)
    {
        var type = RequiredString(shortcut, "type");
        var target = RequiredString(shortcut, "target");
        var args = OptionalString(shortcut, "args");
        var workingDirectory = OptionalString(shortcut, "workingDirectory");
        var runAsAdmin = shortcut.TryGetProperty("runAsAdmin", out var adminElement) && adminElement.ValueKind == JsonValueKind.True;

        if (!string.IsNullOrWhiteSpace(workingDirectory) && !Directory.Exists(workingDirectory))
        {
            throw new DirectoryNotFoundException("작업 폴더를 찾을 수 없어.");
        }

        switch (type)
        {
            case "web":
                if (!Uri.TryCreate(target, UriKind.Absolute, out var uri) ||
                    (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps))
                {
                    throw new InvalidOperationException("http/https 주소만 열 수 있어.");
                }
                StartShell(target, null, workingDirectory, false);
                return;

            case "file":
                EnsureAbsoluteExisting(target, expectDirectory: false);
                StartShell(target, null, workingDirectory, false);
                return;

            case "folder":
                EnsureAbsoluteExisting(target, expectDirectory: true);
                StartShell(target, null, workingDirectory, false);
                return;

            case "app":
                EnsureAbsoluteExisting(target, expectDirectory: false);
                StartShell(target, args, workingDirectory, runAsAdmin);
                return;

            case "command":
                var command = target.Trim();
                if (command.Length == 0)
                {
                    throw new InvalidOperationException("명령어가 비어 있어.");
                }
                StartShell("cmd.exe", $"/d /s /c \"{command}\"", workingDirectory, runAsAdmin);
                return;

            default:
                throw new InvalidOperationException("지원하지 않는 바로가기 유형이야.");
        }
    }

    private static void StartShell(string fileName, string? arguments, string? workingDirectory, bool runAsAdmin)
    {
        var startInfo = new ProcessStartInfo
        {
            FileName = fileName,
            Arguments = arguments ?? string.Empty,
            UseShellExecute = true,
        };
        if (!string.IsNullOrWhiteSpace(workingDirectory))
        {
            startInfo.WorkingDirectory = workingDirectory;
        }
        if (runAsAdmin)
        {
            startInfo.Verb = "runas";
        }

        if (Process.Start(startInfo) is null)
        {
            throw new InvalidOperationException("Windows가 대상을 실행하지 못했어.");
        }
    }

    private static void EnsureAbsoluteExisting(string target, bool expectDirectory)
    {
        if (!Path.IsPathFullyQualified(target))
        {
            throw new InvalidOperationException("로컬 바로가기는 절대 경로가 필요해.");
        }

        if (expectDirectory)
        {
            if (!Directory.Exists(target)) throw new DirectoryNotFoundException("폴더를 찾을 수 없어.");
        }
        else if (!File.Exists(target))
        {
            throw new FileNotFoundException("파일을 찾을 수 없어.", target);
        }
    }

    private static string RequiredString(JsonElement root, string name)
    {
        var value = OptionalString(root, name);
        return !string.IsNullOrWhiteSpace(value)
            ? value
            : throw new InvalidOperationException($"{name} is required");
    }

    private static string? OptionalString(JsonElement root, string name)
    {
        if (!root.TryGetProperty(name, out var element) || element.ValueKind != JsonValueKind.String)
        {
            return null;
        }
        var value = element.GetString()?.Trim();
        return string.IsNullOrWhiteSpace(value) ? null : value;
    }

    private static string? TryIconDataUrl(string path)
    {
        try
        {
            using var icon = Icon.ExtractAssociatedIcon(path);
            if (icon is null) return null;
            using var bitmap = icon.ToBitmap();
            using var stream = new MemoryStream();
            bitmap.Save(stream, ImageFormat.Png);
            return $"data:image/png;base64,{Convert.ToBase64String(stream.ToArray())}";
        }
        catch
        {
            return null;
        }
    }
}
