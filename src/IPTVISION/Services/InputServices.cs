using System.Runtime.InteropServices;
using System.Windows.Input;
using System.Windows.Threading;

namespace IPTVISION.Services;

/// <summary>
/// Legge i controller compatibili XInput (Xbox e la maggior parte dei pad per PC)
/// e li traduce negli stessi tasti della tastiera: tutta l'app si usa allo stesso modo.
///   Croce / levetta sinistra → frecce · A → Invio · B → Esc · X → Spazio · Y → I
///   LB / RB → sezione o episodio/canale precedente/successivo · LT / RT → volume · Start → menu · Back → Esc
/// </summary>
public sealed class GamepadService
{
    private const ushort DpadUp = 0x0001, DpadDown = 0x0002, DpadLeft = 0x0004, DpadRight = 0x0008;
    private const ushort StartButton = 0x0010, Back = 0x0020, Lb = 0x0100, Rb = 0x0200;
    private const ushort A = 0x1000, B = 0x2000, X = 0x4000, Y = 0x8000;
    private const short StickThreshold = 16000;
    private const byte TriggerThreshold = 120;

    private static readonly TimeSpan RepeatDelay = TimeSpan.FromMilliseconds(380);
    private static readonly TimeSpan RepeatRate = TimeSpan.FromMilliseconds(110);

    [StructLayout(LayoutKind.Sequential)]
    private struct XInputGamepad
    {
        public ushort Buttons;
        public byte LeftTrigger;
        public byte RightTrigger;
        public short ThumbLX;
        public short ThumbLY;
        public short ThumbRX;
        public short ThumbRY;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct XInputState
    {
        public uint PacketNumber;
        public XInputGamepad Gamepad;
    }

    [DllImport("xinput1_4.dll", EntryPoint = "XInputGetState")]
    private static extern uint XInputGetState14(uint index, out XInputState state);

    [DllImport("xinput9_1_0.dll", EntryPoint = "XInputGetState")]
    private static extern uint XInputGetState910(uint index, out XInputState state);

    private readonly DispatcherTimer _timer;
    private readonly Action<Key> _onKey;
    private readonly Func<bool> _isActive;
    private readonly HashSet<Key> _down = [];
    private readonly Dictionary<Key, DateTime> _nextRepeat = [];
    private bool _useLegacy;
    private bool _disabled;
    private int _idleTicks;

    public GamepadService(Action<Key> onKey, Func<bool> isActive)
    {
        _onKey = onKey;
        _isActive = isActive;
        _timer = new DispatcherTimer(DispatcherPriority.Input) { Interval = TimeSpan.FromMilliseconds(16) };
        _timer.Tick += (_, _) => Poll();
    }

    public void Start() => _timer.Start();
    public void Stop() => _timer.Stop();

    private bool TryGetState(uint index, out XInputState state)
    {
        state = default;
        try
        {
            return (_useLegacy ? XInputGetState910(index, out state) : XInputGetState14(index, out state)) == 0;
        }
        catch (DllNotFoundException) when (!_useLegacy)
        {
            _useLegacy = true;
            return TryGetState(index, out state);
        }
        catch (Exception ex) when (ex is DllNotFoundException or EntryPointNotFoundException)
        {
            _disabled = true;
            Log.Write("XInput non disponibile: controller disattivati");
            return false;
        }
    }

    private void Poll()
    {
        if (_disabled) { _timer.Stop(); return; }

        // Nessun controller collegato: controlla più di rado (risparmia CPU).
        if (_idleTicks > 0) { _idleTicks--; return; }

        var pressed = new HashSet<Key>();
        var any = false;
        for (uint i = 0; i < 4; i++)
        {
            if (!TryGetState(i, out var s)) continue;
            any = true;
            var g = s.Gamepad;
            void Map(bool on, Key k) { if (on) pressed.Add(k); }
            Map((g.Buttons & DpadUp) != 0 || g.ThumbLY > StickThreshold, Key.Up);
            Map((g.Buttons & DpadDown) != 0 || g.ThumbLY < -StickThreshold, Key.Down);
            Map((g.Buttons & DpadLeft) != 0 || g.ThumbLX < -StickThreshold, Key.Left);
            Map((g.Buttons & DpadRight) != 0 || g.ThumbLX > StickThreshold, Key.Right);
            Map((g.Buttons & A) != 0, Key.Enter);
            Map((g.Buttons & B) != 0, Key.Escape);
            Map((g.Buttons & Back) != 0, Key.Escape);
            Map((g.Buttons & X) != 0, Key.Space);
            Map((g.Buttons & Y) != 0, Key.I);
            Map((g.Buttons & Lb) != 0, Key.F14);
            Map((g.Buttons & Rb) != 0, Key.F15);
            Map((g.Buttons & StartButton) != 0, Key.Apps);
            Map(g.LeftTrigger > TriggerThreshold, Key.OemMinus);
            Map(g.RightTrigger > TriggerThreshold, Key.OemPlus);
        }
        if (!any) { _idleTicks = 60; _down.Clear(); return; }
        if (!_isActive()) { _down.Clear(); return; }

        var now = DateTime.UtcNow;
        foreach (var k in pressed)
        {
            if (_down.Add(k))
            {
                _onKey(k);
                _nextRepeat[k] = now + RepeatDelay;
            }
            else if (IsRepeatable(k) && now >= _nextRepeat.GetValueOrDefault(k))
            {
                _onKey(k);
                _nextRepeat[k] = now + RepeatRate;
            }
        }
        _down.RemoveWhere(k => !pressed.Contains(k));
    }

    private static bool IsRepeatable(Key k) => k is Key.Up or Key.Down or Key.Left or Key.Right or Key.OemMinus or Key.OemPlus;
}

/// <summary>
/// Ricerca vocale con la digitazione vocale di Windows (Win+H): riconosce l'italiano,
/// scrive direttamente nella casella che ha il focus e non appesantisce l'app.
/// </summary>
public static class VoiceTyping
{
    private const byte VkLWin = 0x5B;
    private const byte VkH = 0x48;
    private const uint KeyUp = 0x0002;

    [DllImport("user32.dll")]
    private static extern void keybd_event(byte vk, byte scan, uint flags, IntPtr extra);

    public static void Start()
    {
        keybd_event(VkLWin, 0, 0, IntPtr.Zero);
        keybd_event(VkH, 0, 0, IntPtr.Zero);
        keybd_event(VkH, 0, KeyUp, IntPtr.Zero);
        keybd_event(VkLWin, 0, KeyUp, IntPtr.Zero);
    }
}
