using System.Runtime.InteropServices;
using System.Windows.Interop;

namespace IPTVISION;

/// <summary>
/// Finestra Win32 figlia in cui libVLC disegna il video (Direct3D, decodifica hardware).
/// Sostituisce il VideoView di LibVLCSharp.WPF, che con DPI diversi dal 100% dimensiona male il video.
/// </summary>
public sealed class VideoSurface : HwndHost
{
    private const int WsChild = 0x40000000;
    private const int WsVisible = 0x10000000;
    private const int WsClipChildren = 0x02000000;
    private const int WsClipSiblings = 0x04000000;
    private const int BlackBrush = 4;
    private const string ClassName = "IPTVISION.VideoSurface";

    private delegate IntPtr NativeWndProc(IntPtr hwnd, uint msg, IntPtr wParam, IntPtr lParam);

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct WndClassEx
    {
        public uint cbSize;
        public uint style;
        public IntPtr lpfnWndProc;
        public int cbClsExtra;
        public int cbWndExtra;
        public IntPtr hInstance;
        public IntPtr hIcon;
        public IntPtr hCursor;
        public IntPtr hbrBackground;
        public string? lpszMenuName;
        public string lpszClassName;
        public IntPtr hIconSm;
    }

    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern ushort RegisterClassEx(ref WndClassEx wc);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern IntPtr DefWindowProc(IntPtr hwnd, uint msg, IntPtr wParam, IntPtr lParam);

    [DllImport("gdi32.dll")]
    private static extern IntPtr GetStockObject(int obj);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    private static extern IntPtr GetModuleHandle(string? name);

    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr CreateWindowEx(int exStyle, string className, string windowName, int style,
        int x, int y, int width, int height, IntPtr parent, IntPtr menu, IntPtr instance, IntPtr param);

    [DllImport("user32.dll")]
    private static extern bool DestroyWindow(IntPtr hwnd);

    // Il delegato deve restare vivo finché esiste la classe di finestra.
    private static readonly NativeWndProc Proc = DefWindowProc;
    private static bool _registered;

    /// <summary>Scatta quando la finestra nativa esiste e libVLC può usarla.</summary>
    public event Action<IntPtr>? HandleReady;

    /// <summary>
    /// Classe propria con sfondo nero: il controllo "static" usa il colore di sistema
    /// della cornice (grigio su Windows 11), visibile quando VLC ricrea la sua finestra.
    /// </summary>
    private static void EnsureClass(IntPtr hInstance)
    {
        if (_registered) return;
        var wc = new WndClassEx
        {
            cbSize = (uint)Marshal.SizeOf<WndClassEx>(),
            lpfnWndProc = Marshal.GetFunctionPointerForDelegate(Proc),
            hInstance = hInstance,
            hbrBackground = GetStockObject(BlackBrush),
            lpszClassName = ClassName,
        };
        RegisterClassEx(ref wc);
        _registered = true;
    }

    protected override HandleRef BuildWindowCore(HandleRef hwndParent)
    {
        var hInstance = GetModuleHandle(null);
        EnsureClass(hInstance);
        var hwnd = CreateWindowEx(0, ClassName, "", WsChild | WsVisible | WsClipChildren | WsClipSiblings,
            0, 0, 1, 1, hwndParent.Handle, IntPtr.Zero, hInstance, IntPtr.Zero);
        HandleReady?.Invoke(hwnd);
        return new HandleRef(this, hwnd);
    }

    protected override void DestroyWindowCore(HandleRef hwnd) => DestroyWindow(hwnd.Handle);
}
