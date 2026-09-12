using System.Runtime.InteropServices;

namespace WallpaperHostPoc;

/// <summary>
/// Mouse-only bridge used while the host is behind Explorer's desktop layer.
/// It never synthesizes keyboard input. A captured empty-desktop click is replayed once
/// after the existing host HWND has entered the normal Interactive WebView2 state.
/// </summary>
internal sealed class DesktopClickInterceptor : IDisposable
{
    private readonly Func<NativeMethods.POINT, bool> _shouldCapture;
    private readonly Action<NativeMethods.POINT> _capturedClick;
    private readonly NativeMethods.LowLevelMouseProc _hookProc;

    private nint _hook;
    private bool _capturingLeftButton;

    internal DesktopClickInterceptor(
        Func<NativeMethods.POINT, bool> shouldCapture,
        Action<NativeMethods.POINT> capturedClick)
    {
        _shouldCapture = shouldCapture;
        _capturedClick = capturedClick;
        _hookProc = HookCallback;
    }

    internal bool Start(out string status)
    {
        if (_hook != nint.Zero)
        {
            status = "Click-to-interact hook is already active.";
            return true;
        }

        var module = NativeMethods.GetModuleHandle(null);
        _hook = NativeMethods.SetWindowsHookEx(
            NativeMethods.WH_MOUSE_LL,
            _hookProc,
            module,
            0);

        if (_hook == nint.Zero)
        {
            status =
                $"Could not install the click-to-interact mouse hook. Win32 error: " +
                $"{Marshal.GetLastWin32Error()}.";
            return false;
        }

        status = "Click-to-interact mouse hook installed.";
        return true;
    }

    internal static bool IsEligibleDesktopPoint(
        NativeMethods.POINT screenPoint,
        nint hostHwnd)
    {
        var target = NativeMethods.WindowFromPoint(screenPoint);
        if (target == nint.Zero)
        {
            return false;
        }

        if (target == hostHwnd)
        {
            return true;
        }

        var className = NativeMethods.GetWindowClassName(target);

        if (className.Equals("SysListView32", StringComparison.Ordinal))
        {
            // The desktop ListView fills the desktop, so distinguish an actual icon
            // from empty background before intercepting the click.
            return !IsListViewItemAtPoint(target, screenPoint);
        }

        if (className.Equals("SHELLDLL_DefView", StringComparison.Ordinal))
        {
            var listView = NativeMethods.FindWindowEx(
                target,
                nint.Zero,
                "SysListView32",
                "FolderView");

            // Fail closed if Explorer's ListView cannot be resolved. Preserving the
            // original desktop click is safer than risking an icon click being hijacked.
            if (listView == nint.Zero)
            {
                return false;
            }

            return !IsListViewItemAtPoint(listView, screenPoint);
        }

        return className.Equals("WorkerW", StringComparison.Ordinal) ||
               className.Equals("Progman", StringComparison.Ordinal);
    }

    internal static bool ReplayLeftClick(out string status)
    {
        var inputs = new[]
        {
            NativeMethods.INPUT.Mouse(NativeMethods.MOUSEEVENTF_LEFTDOWN),
            NativeMethods.INPUT.Mouse(NativeMethods.MOUSEEVENTF_LEFTUP),
        };
        var expected = checked((uint)inputs.Length);

        var sent = NativeMethods.SendInput(
            expected,
            inputs,
            Marshal.SizeOf<NativeMethods.INPUT>());

        if (sent != expected)
        {
            status =
                $"Mouse replay sent {sent}/{expected} events. Win32 error: " +
                $"{Marshal.GetLastWin32Error()}.";
            return false;
        }

        status = "Captured desktop click replayed into Interactive mode.";
        return true;
    }

    private nint HookCallback(int code, nint wParam, nint lParam)
    {
        if (code < 0)
        {
            return NativeMethods.CallNextHookEx(_hook, code, wParam, lParam);
        }

        try
        {
            var mouse = Marshal.PtrToStructure<NativeMethods.MSLLHOOKSTRUCT>(lParam);

            // Never intercept our own one-shot mouse replay or another injected click.
            if ((mouse.Flags & NativeMethods.LLMHF_INJECTED) != 0)
            {
                return NativeMethods.CallNextHookEx(_hook, code, wParam, lParam);
            }

            var message = unchecked((uint)wParam.ToInt64());

            if (message == NativeMethods.WM_LBUTTONDOWN)
            {
                if (_shouldCapture(mouse.Point))
                {
                    _capturingLeftButton = true;
                    return new nint(1);
                }
            }
            else if (message == NativeMethods.WM_LBUTTONUP && _capturingLeftButton)
            {
                _capturingLeftButton = false;

                try
                {
                    _capturedClick(mouse.Point);
                }
                catch (Exception ex)
                {
                    AppLog.Error("Click-to-interact callback failed.", ex);
                }

                return new nint(1);
            }
        }
        catch (Exception ex)
        {
            // A hook callback must never tear down the process. Preserve the original
            // mouse input and record the failure instead.
            AppLog.Error("Click-to-interact mouse hook failed.", ex);
            _capturingLeftButton = false;
        }

        return NativeMethods.CallNextHookEx(_hook, code, wParam, lParam);
    }

    private static bool IsListViewItemAtPoint(
        nint listView,
        NativeMethods.POINT screenPoint)
    {
        var clientPoint = screenPoint;
        if (!NativeMethods.ScreenToClient(listView, ref clientPoint))
        {
            return true;
        }

        _ = NativeMethods.GetWindowThreadProcessId(listView, out var processId);
        if (processId == 0)
        {
            return true;
        }

        var process = NativeMethods.OpenProcess(
            NativeMethods.PROCESS_VM_OPERATION | NativeMethods.PROCESS_VM_WRITE,
            false,
            processId);

        if (process == nint.Zero)
        {
            return true;
        }

        nint remote = nint.Zero;
        nint local = nint.Zero;

        try
        {
            var hitInfo = new NativeMethods.LVHITTESTINFO
            {
                Point = clientPoint,
                Item = -1,
                SubItem = -1,
                Group = -1,
            };

            var size = Marshal.SizeOf<NativeMethods.LVHITTESTINFO>();
            local = Marshal.AllocHGlobal(size);
            Marshal.StructureToPtr(hitInfo, local, false);

            remote = NativeMethods.VirtualAllocEx(
                process,
                nint.Zero,
                checked((nuint)size),
                NativeMethods.MEM_COMMIT | NativeMethods.MEM_RESERVE,
                NativeMethods.PAGE_READWRITE);

            if (remote == nint.Zero)
            {
                return true;
            }

            if (!NativeMethods.WriteProcessMemory(
                    process,
                    remote,
                    local,
                    checked((nuint)size),
                    out var written) ||
                written != checked((nuint)size))
            {
                return true;
            }

            if (NativeMethods.SendMessageTimeout(
                    listView,
                    NativeMethods.LVM_HITTEST,
                    0,
                    remote,
                    NativeMethods.SMTO_ABORTIFHUNG,
                    100,
                    out var result) == nint.Zero)
            {
                return true;
            }

            var itemIndex = unchecked((nint)result).ToInt64();
            return itemIndex >= 0;
        }
        finally
        {
            if (remote != nint.Zero)
            {
                _ = NativeMethods.VirtualFreeEx(
                    process,
                    remote,
                    0,
                    NativeMethods.MEM_RELEASE);
            }

            if (local != nint.Zero)
            {
                Marshal.FreeHGlobal(local);
            }

            _ = NativeMethods.CloseHandle(process);
        }
    }

    public void Dispose()
    {
        _capturingLeftButton = false;

        if (_hook != nint.Zero)
        {
            _ = NativeMethods.UnhookWindowsHookEx(_hook);
            _hook = nint.Zero;
        }
    }
}
