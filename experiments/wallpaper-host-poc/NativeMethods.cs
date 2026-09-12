using System.Runtime.InteropServices;
using System.Text;

namespace WallpaperHostPoc;

internal static class NativeMethods
{
    internal const int GWL_STYLE = -16;
    internal const int GWL_EXSTYLE = -20;

    internal const long WS_CHILD = 0x40000000L;
    internal const long WS_POPUP = 0x80000000L;
    internal const long WS_CAPTION = 0x00C00000L;
    internal const long WS_THICKFRAME = 0x00040000L;
    internal const long WS_MINIMIZEBOX = 0x00020000L;
    internal const long WS_MAXIMIZEBOX = 0x00010000L;
    internal const long WS_SYSMENU = 0x00080000L;

    internal const long WS_EX_TOOLWINDOW = 0x00000080L;
    internal const long WS_EX_APPWINDOW = 0x00040000L;

    internal const uint SWP_NOACTIVATE = 0x0010;
    internal const uint SWP_NOMOVE = 0x0002;
    internal const uint SWP_NOSIZE = 0x0001;
    internal const uint SWP_FRAMECHANGED = 0x0020;
    internal const uint SWP_SHOWWINDOW = 0x0040;

    internal const uint SMTO_NORMAL = 0x0000;
    internal const uint SMTO_ABORTIFHUNG = 0x0002;
    internal const uint SPAWN_WORKERW_MESSAGE = 0x052C;

    internal const int WM_DISPLAYCHANGE = 0x007E;
    internal const int WM_HOTKEY = 0x0312;
    internal const uint WM_LBUTTONDOWN = 0x0201;
    internal const uint WM_LBUTTONUP = 0x0202;

    internal const uint MOD_ALT = 0x0001;
    internal const uint MOD_CONTROL = 0x0002;
    internal const uint VK_W = 0x57;

    internal const int WH_MOUSE_LL = 14;
    internal const uint LLMHF_INJECTED = 0x00000001;

    internal const uint INPUT_MOUSE = 0;
    internal const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
    internal const uint MOUSEEVENTF_LEFTUP = 0x0004;

    internal const uint LVM_FIRST = 0x1000;
    internal const uint LVM_HITTEST = LVM_FIRST + 18;

    internal const uint PROCESS_VM_OPERATION = 0x0008;
    internal const uint PROCESS_VM_WRITE = 0x0020;
    internal const uint MEM_COMMIT = 0x1000;
    internal const uint MEM_RESERVE = 0x2000;
    internal const uint MEM_RELEASE = 0x8000;
    internal const uint PAGE_READWRITE = 0x04;

    internal static readonly nint HWND_TOP = nint.Zero;
    internal static readonly nint HWND_BOTTOM = new(1);

    internal delegate bool EnumWindowsProc(nint hWnd, nint lParam);
    internal delegate nint LowLevelMouseProc(int nCode, nint wParam, nint lParam);

    [StructLayout(LayoutKind.Sequential)]
    internal struct POINT
    {
        internal int X;
        internal int Y;
    }

    [StructLayout(LayoutKind.Sequential)]
    internal struct RECT
    {
        internal int Left;
        internal int Top;
        internal int Right;
        internal int Bottom;

        internal int Width => Right - Left;
        internal int Height => Bottom - Top;
    }

    [StructLayout(LayoutKind.Sequential)]
    internal struct MSLLHOOKSTRUCT
    {
        internal POINT Point;
        internal uint MouseData;
        internal uint Flags;
        internal uint Time;
        internal nuint ExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    internal struct LVHITTESTINFO
    {
        internal POINT Point;
        internal uint Flags;
        internal int Item;
        internal int SubItem;
        internal int Group;
    }

    [StructLayout(LayoutKind.Sequential)]
    internal struct MOUSEINPUT
    {
        internal int Dx;
        internal int Dy;
        internal uint MouseData;
        internal uint Flags;
        internal uint Time;
        internal nuint ExtraInfo;
    }

    [StructLayout(LayoutKind.Explicit)]
    internal struct INPUTUNION
    {
        [FieldOffset(0)]
        internal MOUSEINPUT MouseInput;
    }

    [StructLayout(LayoutKind.Sequential)]
    internal struct INPUT
    {
        internal uint Type;
        internal INPUTUNION Union;

        internal static INPUT Mouse(uint flags) => new()
        {
            Type = INPUT_MOUSE,
            Union = new INPUTUNION
            {
                MouseInput = new MOUSEINPUT
                {
                    Flags = flags,
                },
            },
        };
    }

    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    internal static extern nint FindWindow(string? lpClassName, string? lpWindowName);

    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    internal static extern nint FindWindowEx(
        nint hWndParent,
        nint hWndChildAfter,
        string? lpszClass,
        string? lpszWindow);

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, nint lParam);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    internal static extern int GetClassName(nint hWnd, StringBuilder lpClassName, int nMaxCount);

    [DllImport("user32.dll", SetLastError = true)]
    internal static extern nint SendMessageTimeout(
        nint hWnd,
        uint Msg,
        nuint wParam,
        nint lParam,
        uint fuFlags,
        uint uTimeout,
        out nuint lpdwResult);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool SetForegroundWindow(nint hWnd);

    [DllImport("user32.dll")]
    internal static extern nint GetForegroundWindow();

    [DllImport("user32.dll")]
    internal static extern nint WindowFromPoint(POINT point);

    [DllImport("user32.dll")]
    internal static extern uint GetWindowThreadProcessId(
        nint hWnd,
        out uint lpdwProcessId);

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool RegisterHotKey(
        nint hWnd,
        int id,
        uint fsModifiers,
        uint vk);

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool UnregisterHotKey(nint hWnd, int id);

    [DllImport("user32.dll", SetLastError = true)]
    internal static extern nint SetWindowsHookEx(
        int idHook,
        LowLevelMouseProc lpfn,
        nint hMod,
        uint dwThreadId);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool UnhookWindowsHookEx(nint hhk);

    [DllImport("user32.dll")]
    internal static extern nint CallNextHookEx(
        nint hhk,
        int nCode,
        nint wParam,
        nint lParam);

    [DllImport("user32.dll", SetLastError = true)]
    internal static extern uint SendInput(
        uint cInputs,
        INPUT[] pInputs,
        int cbSize);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool IsWindow(nint hWnd);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool ScreenToClient(nint hWnd, ref POINT lpPoint);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    internal static extern nint GetModuleHandle(string? lpModuleName);

    [DllImport("kernel32.dll", SetLastError = true)]
    internal static extern nint OpenProcess(
        uint dwDesiredAccess,
        [MarshalAs(UnmanagedType.Bool)] bool bInheritHandle,
        uint dwProcessId);

    [DllImport("kernel32.dll", SetLastError = true)]
    internal static extern nint VirtualAllocEx(
        nint hProcess,
        nint lpAddress,
        nuint dwSize,
        uint flAllocationType,
        uint flProtect);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool VirtualFreeEx(
        nint hProcess,
        nint lpAddress,
        nuint dwSize,
        uint dwFreeType);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool WriteProcessMemory(
        nint hProcess,
        nint lpBaseAddress,
        nint lpBuffer,
        nuint nSize,
        out nuint lpNumberOfBytesWritten);

    [DllImport("kernel32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool CloseHandle(nint hObject);

    [DllImport("kernel32.dll")]
    internal static extern void SetLastError(uint dwErrCode);

    [DllImport("user32.dll", SetLastError = true)]
    internal static extern nint SetParent(nint hWndChild, nint hWndNewParent);

    [DllImport("user32.dll", SetLastError = true)]
    internal static extern nint GetParent(nint hWnd);

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool GetClientRect(nint hWnd, out RECT lpRect);

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool SetWindowPos(
        nint hWnd,
        nint hWndInsertAfter,
        int X,
        int Y,
        int cx,
        int cy,
        uint uFlags);

    [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW", SetLastError = true)]
    private static extern nint GetWindowLongPtr64(nint hWnd, int nIndex);

    [DllImport("user32.dll", EntryPoint = "GetWindowLongW", SetLastError = true)]
    private static extern nint GetWindowLongPtr32(nint hWnd, int nIndex);

    [DllImport("user32.dll", EntryPoint = "SetWindowLongPtrW", SetLastError = true)]
    private static extern nint SetWindowLongPtr64(nint hWnd, int nIndex, nint dwNewLong);

    [DllImport("user32.dll", EntryPoint = "SetWindowLongW", SetLastError = true)]
    private static extern nint SetWindowLongPtr32(nint hWnd, int nIndex, nint dwNewLong);

    internal static nint GetWindowLongPtr(nint hWnd, int nIndex) =>
        nint.Size == 8
            ? GetWindowLongPtr64(hWnd, nIndex)
            : GetWindowLongPtr32(hWnd, nIndex);

    internal static nint SetWindowLongPtr(nint hWnd, int nIndex, nint value) =>
        nint.Size == 8
            ? SetWindowLongPtr64(hWnd, nIndex, value)
            : SetWindowLongPtr32(hWnd, nIndex, value);

    internal static string GetWindowClassName(nint hWnd)
    {
        var buffer = new StringBuilder(256);
        return GetClassName(hWnd, buffer, buffer.Capacity) > 0
            ? buffer.ToString()
            : string.Empty;
    }
}
