# ============================================================================
#  Deck Control - Agente Windows
#  Processo PowerShell de vida longa. Le uma requisicao JSON por linha em stdin
#  e responde uma linha JSON em stdout. Manter o processo vivo evita o custo de
#  ~200ms de spawn por acao, o que tornaria o deck perceptivelmente lento.
#
#  IMPORTANTE: nada alem das respostas JSON pode ir para stdout.
# ============================================================================

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

# ---------------------------------------------------------------------------
# Interop nativo: entrada sintetica, janelas e volume (CoreAudio).
# ---------------------------------------------------------------------------
$interop = @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

namespace Deck {

  public static class Input {
    [StructLayout(LayoutKind.Sequential)]
    public struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
    [StructLayout(LayoutKind.Sequential)]
    public struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
    [StructLayout(LayoutKind.Sequential)]
    public struct HARDWAREINPUT { public uint uMsg; public ushort wParamL; public ushort wParamH; }
    [StructLayout(LayoutKind.Explicit)]
    public struct INPUTUNION {
      [FieldOffset(0)] public MOUSEINPUT mi;
      [FieldOffset(0)] public KEYBDINPUT ki;
      [FieldOffset(0)] public HARDWAREINPUT hi;
    }
    [StructLayout(LayoutKind.Sequential)]
    public struct INPUT { public uint type; public INPUTUNION u; }

    [DllImport("user32.dll", SetLastError = true)]
    private static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);

    private const uint INPUT_KEYBOARD = 1;
    private const uint KEYEVENTF_EXTENDEDKEY = 0x0001;
    private const uint KEYEVENTF_KEYUP = 0x0002;
    private const uint KEYEVENTF_UNICODE = 0x0004;

    // Teclas do bloco estendido precisam do flag, caso contrario o Windows
    // entrega a variante do teclado numerico (setas viram numeros, etc).
    private static bool IsExtended(ushort vk) {
      switch (vk) {
        case 0x21: case 0x22: case 0x23: case 0x24:
        case 0x25: case 0x26: case 0x27: case 0x28:
        case 0x2D: case 0x2E: case 0x5B: case 0x5C: case 0x5D:
        case 0xA3: case 0xA5: case 0x90: case 0x6F:
        case 0xAD: case 0xAE: case 0xAF:
        case 0xB0: case 0xB1: case 0xB2: case 0xB3:
          return true;
        default:
          return false;
      }
    }

    private static INPUT MakeKey(ushort vk, bool keyUp) {
      INPUT input = new INPUT();
      input.type = INPUT_KEYBOARD;
      input.u.ki.wVk = vk;
      input.u.ki.wScan = 0;
      input.u.ki.dwFlags = (keyUp ? KEYEVENTF_KEYUP : 0u) | (IsExtended(vk) ? KEYEVENTF_EXTENDEDKEY : 0u);
      input.u.ki.time = 0;
      input.u.ki.dwExtraInfo = IntPtr.Zero;
      return input;
    }

    /// Pressiona o acorde na ordem recebida e solta na ordem inversa,
    /// que e' como um humano digitaria Ctrl+Shift+S.
    public static uint Chord(ushort[] keys) {
      List<INPUT> batch = new List<INPUT>();
      for (int i = 0; i < keys.Length; i++) batch.Add(MakeKey(keys[i], false));
      for (int i = keys.Length - 1; i >= 0; i--) batch.Add(MakeKey(keys[i], true));
      INPUT[] arr = batch.ToArray();
      return SendInput((uint)arr.Length, arr, Marshal.SizeOf(typeof(INPUT)));
    }

    public static uint Tap(ushort vk) {
      return Chord(new ushort[] { vk });
    }

    /// Digita texto por codepoint UTF-16, independente do layout do teclado.
    public static uint TypeText(string text) {
      List<INPUT> batch = new List<INPUT>();
      foreach (char c in text) {
        INPUT down = new INPUT();
        down.type = INPUT_KEYBOARD;
        down.u.ki.wVk = 0;
        down.u.ki.wScan = (ushort)c;
        down.u.ki.dwFlags = KEYEVENTF_UNICODE;
        down.u.ki.time = 0;
        down.u.ki.dwExtraInfo = IntPtr.Zero;
        INPUT up = down;
        up.u.ki.dwFlags = KEYEVENTF_UNICODE | KEYEVENTF_KEYUP;
        batch.Add(down);
        batch.Add(up);
      }
      if (batch.Count == 0) return 0;
      INPUT[] arr = batch.ToArray();
      return SendInput((uint)arr.Length, arr, Marshal.SizeOf(typeof(INPUT)));
    }
  }

  public class WindowInfo {
    public long Handle { get; set; }
    public string Title { get; set; }
    public string Process { get; set; }
    public int ProcessId { get; set; }
    public bool Foreground { get; set; }
    public bool Minimized { get; set; }
  }

  public static class Windows {
    private delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll")] private static extern bool EnumWindows(EnumWindowsProc cb, IntPtr lParam);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")] private static extern bool IsIconic(IntPtr hWnd);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowTextLength(IntPtr hWnd);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowText(IntPtr hWnd, StringBuilder buffer, int max);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
    [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] private static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] private static extern bool ShowWindow(IntPtr hWnd, int cmd);
    [DllImport("user32.dll")] private static extern bool BringWindowToTop(IntPtr hWnd);
    [DllImport("user32.dll")] private static extern bool AttachThreadInput(uint attach, uint attachTo, bool doAttach);
    [DllImport("user32.dll")] private static extern IntPtr GetWindow(IntPtr hWnd, uint cmd);
    [DllImport("user32.dll")] private static extern int GetWindowLong(IntPtr hWnd, int index);
    [DllImport("user32.dll")] private static extern bool PostMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);
    [DllImport("kernel32.dll")] private static extern uint GetCurrentThreadId();
    [DllImport("dwmapi.dll")] private static extern int DwmGetWindowAttribute(IntPtr hWnd, int attr, out int value, int size);

    private const int GWL_EXSTYLE = -20;
    private const int WS_EX_TOOLWINDOW = 0x00000080;
    private const int DWMWA_CLOAKED = 14;
    private const uint GW_OWNER = 4;
    private const int SW_RESTORE = 9;
    private const int SW_MINIMIZE = 6;
    private const uint WM_CLOSE = 0x0010;

    /// Filtra o que o Alt+Tab tambem esconderia: janelas-ferramenta, janelas
    /// com dono e as janelas "fantasma" cloaked das apps UWP.
    private static bool IsAltTabWindow(IntPtr hWnd) {
      if (!IsWindowVisible(hWnd)) return false;
      if (GetWindow(hWnd, GW_OWNER) != IntPtr.Zero) return false;
      if ((GetWindowLong(hWnd, GWL_EXSTYLE) & WS_EX_TOOLWINDOW) != 0) return false;
      if (GetWindowTextLength(hWnd) == 0) return false;
      int cloaked;
      if (DwmGetWindowAttribute(hWnd, DWMWA_CLOAKED, out cloaked, sizeof(int)) == 0 && cloaked != 0) return false;
      return true;
    }

    public static WindowInfo[] List() {
      List<WindowInfo> found = new List<WindowInfo>();
      IntPtr foreground = GetForegroundWindow();
      // O delegate fica em uma variavel local para permanecer alcancavel pelo
      // GC durante toda a enumeracao.
      EnumWindowsProc callback = delegate(IntPtr hWnd, IntPtr lParam) {
        if (!IsAltTabWindow(hWnd)) return true;
        int len = GetWindowTextLength(hWnd);
        StringBuilder sb = new StringBuilder(len + 1);
        GetWindowText(hWnd, sb, sb.Capacity);
        uint pid;
        GetWindowThreadProcessId(hWnd, out pid);
        string procName = "";
        try { procName = System.Diagnostics.Process.GetProcessById((int)pid).ProcessName; } catch { }
        WindowInfo info = new WindowInfo();
        info.Handle = hWnd.ToInt64();
        info.Title = sb.ToString();
        info.Process = procName;
        info.ProcessId = (int)pid;
        info.Foreground = (hWnd == foreground);
        info.Minimized = IsIconic(hWnd);
        found.Add(info);
        return true;
      };
      EnumWindows(callback, IntPtr.Zero);
      GC.KeepAlive(callback);
      return found.ToArray();
    }

    /// O Windows bloqueia SetForegroundWindow vindo de processos em segundo
    /// plano. Anexar a fila de entrada da thread em foco libera a troca.
    public static bool Activate(long handle) {
      IntPtr hWnd = new IntPtr(handle);
      if (hWnd == IntPtr.Zero) return false;
      if (IsIconic(hWnd)) ShowWindow(hWnd, SW_RESTORE);
      IntPtr foreground = GetForegroundWindow();
      uint scratchPid;
      // Sem descartes (`out _`): o compilador C# do PowerShell 5.1 e' C# 5.
      uint targetThread = GetWindowThreadProcessId(hWnd, out scratchPid);
      uint currentThread = GetCurrentThreadId();
      uint foregroundThread = currentThread;
      if (foreground != IntPtr.Zero) foregroundThread = GetWindowThreadProcessId(foreground, out scratchPid);
      bool attachedFg = foregroundThread != currentThread && AttachThreadInput(currentThread, foregroundThread, true);
      bool attachedTarget = targetThread != currentThread && AttachThreadInput(currentThread, targetThread, true);
      BringWindowToTop(hWnd);
      bool ok = SetForegroundWindow(hWnd);
      if (attachedTarget) AttachThreadInput(currentThread, targetThread, false);
      if (attachedFg) AttachThreadInput(currentThread, foregroundThread, false);
      return ok;
    }

    public static bool Minimize(long handle) { return ShowWindow(new IntPtr(handle), SW_MINIMIZE); }
    public static bool Close(long handle) { return PostMessage(new IntPtr(handle), WM_CLOSE, IntPtr.Zero, IntPtr.Zero); }
  }

  // --- CoreAudio: volume absoluto do dispositivo padrao (saida ou microfone) ---
  [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  internal interface IMMDevice {
    int Activate([MarshalAs(UnmanagedType.LPStruct)] Guid iid, uint ctx, IntPtr activationParams,
                 [MarshalAs(UnmanagedType.IUnknown)] out object iface);
    int OpenPropertyStore(uint access, out IntPtr store);
    int GetId([MarshalAs(UnmanagedType.LPWStr)] out string id);
    int GetState(out uint state);
  }

  [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  internal interface IMMDeviceEnumerator {
    int EnumAudioEndpoints(int dataFlow, uint stateMask, out IntPtr collection);
    int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice device);
    int GetDevice([MarshalAs(UnmanagedType.LPWStr)] string id, out IMMDevice device);
    int RegisterEndpointNotificationCallback(IntPtr client);
    int UnregisterEndpointNotificationCallback(IntPtr client);
  }

  [ComImport, Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  internal interface IAudioEndpointVolume {
    int RegisterControlChangeNotify(IntPtr notify);
    int UnregisterControlChangeNotify(IntPtr notify);
    int GetChannelCount(out uint count);
    int SetMasterVolumeLevel(float levelDb, [MarshalAs(UnmanagedType.LPStruct)] Guid eventContext);
    int SetMasterVolumeLevelScalar(float level, [MarshalAs(UnmanagedType.LPStruct)] Guid eventContext);
    int GetMasterVolumeLevel(out float levelDb);
    int GetMasterVolumeLevelScalar(out float level);
    int SetChannelVolumeLevel(uint channel, float levelDb, [MarshalAs(UnmanagedType.LPStruct)] Guid eventContext);
    int SetChannelVolumeLevelScalar(uint channel, float level, [MarshalAs(UnmanagedType.LPStruct)] Guid eventContext);
    int GetChannelVolumeLevel(uint channel, out float levelDb);
    int GetChannelVolumeLevelScalar(uint channel, out float level);
    int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, [MarshalAs(UnmanagedType.LPStruct)] Guid eventContext);
    int GetMute([MarshalAs(UnmanagedType.Bool)] out bool mute);
    int GetVolumeStepInfo(out uint step, out uint stepCount);
    int VolumeStepUp([MarshalAs(UnmanagedType.LPStruct)] Guid eventContext);
    int VolumeStepDown([MarshalAs(UnmanagedType.LPStruct)] Guid eventContext);
    int QueryHardwareSupport(out uint mask);
    int GetVolumeRange(out float min, out float max, out float increment);
  }

  [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
  internal class MMDeviceEnumeratorComObject { }

  public static class Power {
    [DllImport("user32.dll")]
    private static extern IntPtr SendMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);

    private const uint WM_SYSCOMMAND = 0x0112;
    private const int SC_MONITORPOWER = 0xF170;
    private static readonly IntPtr HWND_BROADCAST = new IntPtr(0xFFFF);

    public static void MonitorsOff() {
      SendMessage(HWND_BROADCAST, WM_SYSCOMMAND, new IntPtr(SC_MONITORPOWER), new IntPtr(2));
    }
  }

  public static class Audio {
    private static readonly Guid IID_IAudioEndpointVolume = new Guid("5CDF2C82-841E-4546-9722-0CF74078229A");

    // dataFlow: 0 = saida (render), 1 = captura (microfone)
    private static IAudioEndpointVolume Endpoint(int dataFlow) {
      IMMDeviceEnumerator enumerator = (IMMDeviceEnumerator)(new MMDeviceEnumeratorComObject());
      IMMDevice device;
      int hr = enumerator.GetDefaultAudioEndpoint(dataFlow, 0, out device);
      if (hr != 0 || device == null) throw new InvalidOperationException("nenhum dispositivo de audio padrao");
      object iface;
      hr = device.Activate(IID_IAudioEndpointVolume, 23 /* CLSCTX_ALL */, IntPtr.Zero, out iface);
      if (hr != 0 || iface == null) throw new InvalidOperationException("falha ao abrir o controle de volume");
      return (IAudioEndpointVolume)iface;
    }

    public static float GetVolume(int dataFlow) {
      float level;
      Endpoint(dataFlow).GetMasterVolumeLevelScalar(out level);
      return level;
    }

    public static void SetVolume(int dataFlow, float level) {
      if (level < 0f) level = 0f;
      if (level > 1f) level = 1f;
      Endpoint(dataFlow).SetMasterVolumeLevelScalar(level, Guid.Empty);
    }

    public static bool GetMute(int dataFlow) {
      bool muted;
      Endpoint(dataFlow).GetMute(out muted);
      return muted;
    }

    public static void SetMute(int dataFlow, bool muted) {
      Endpoint(dataFlow).SetMute(muted, Guid.Empty);
    }
  }
}
'@

Add-Type -TypeDefinition $interop -Language CSharp | Out-Null

# ---------------------------------------------------------------------------
# Mapa de nomes de tecla -> virtual-key code.
# ---------------------------------------------------------------------------
$script:VirtualKeys = @{
  'ctrl' = 0x11; 'control' = 0x11; 'lctrl' = 0xA2; 'rctrl' = 0xA3
  'shift' = 0x10; 'lshift' = 0xA0; 'rshift' = 0xA1
  'alt' = 0x12; 'lalt' = 0xA4; 'ralt' = 0xA5
  'win' = 0x5B; 'lwin' = 0x5B; 'rwin' = 0x5C; 'meta' = 0x5B; 'cmd' = 0x5B
  'enter' = 0x0D; 'return' = 0x0D; 'tab' = 0x09; 'esc' = 0x1B; 'escape' = 0x1B
  'space' = 0x20; 'backspace' = 0x08; 'delete' = 0x2E; 'del' = 0x2E; 'insert' = 0x2D
  'home' = 0x24; 'end' = 0x23; 'pageup' = 0x21; 'pagedown' = 0x22
  'left' = 0x25; 'up' = 0x26; 'right' = 0x27; 'down' = 0x28
  'printscreen' = 0x2C; 'prtsc' = 0x2C; 'capslock' = 0x14; 'numlock' = 0x90
  'plus' = 0xBB; 'minus' = 0xBD; 'comma' = 0xBC; 'period' = 0xBE
  'semicolon' = 0xBA; 'slash' = 0xBF; 'backslash' = 0xDC; 'tilde' = 0xC0
  'openbracket' = 0xDB; 'closebracket' = 0xDD; 'quote' = 0xDE
  'volumeup' = 0xAF; 'volumedown' = 0xAE; 'volumemute' = 0xAD
  'playpause' = 0xB3; 'nexttrack' = 0xB0; 'prevtrack' = 0xB1; 'stoptrack' = 0xB2
  'apps' = 0x5D; 'menu' = 0x5D; 'pause' = 0x13; 'scrolllock' = 0x91
}

function Resolve-VirtualKey {
  param([string]$Name)
  $key = $Name.Trim().ToLowerInvariant()
  if ($key.Length -eq 0) { throw "tecla vazia" }
  if ($script:VirtualKeys.ContainsKey($key)) { return [uint16]$script:VirtualKeys[$key] }
  if ($key -match '^f([1-9]|1[0-9]|2[0-4])$') { return [uint16](0x70 + [int]$Matches[1] - 1) }
  if ($key -match '^num([0-9])$') { return [uint16](0x60 + [int]$Matches[1]) }
  if ($key.Length -eq 1) {
    $ch = $key[0]
    if ($ch -ge 'a' -and $ch -le 'z') { return [uint16](0x41 + ([int][char]$ch - [int][char]'a')) }
    if ($ch -ge '0' -and $ch -le '9') { return [uint16](0x30 + ([int][char]$ch - [int][char]'0')) }
  }
  throw "tecla desconhecida: $Name"
}

function Invoke-Hotkey {
  param([string]$Keys)
  $parts = $Keys -split '\+' | Where-Object { $_.Trim().Length -gt 0 }
  if ($parts.Count -eq 0) { throw "combinacao vazia" }
  $codes = [uint16[]]@($parts | ForEach-Object { Resolve-VirtualKey $_ })
  [Deck.Input]::Chord($codes) | Out-Null
  return @{ keys = $Keys; count = $codes.Count }
}

# ---------------------------------------------------------------------------
# Telemetria de reserva (sem LibreHardwareMonitor).
# Usa classes CIM em vez de Get-Counter: nomes de contador sao traduzidos em
# Windows localizado, os nomes de classe CIM nao.
# ---------------------------------------------------------------------------
function Get-CpuLoad {
  try {
    $cpu = Get-CimInstance -ClassName Win32_PerfFormattedData_PerfOS_Processor -ErrorAction Stop |
           Where-Object { $_.Name -eq '_Total' } | Select-Object -First 1
    if ($cpu) { return [math]::Round([double]$cpu.PercentProcessorTime, 1) }
  } catch { }
  try {
    $load = (Get-CimInstance -ClassName Win32_Processor -ErrorAction Stop |
             Measure-Object -Property LoadPercentage -Average).Average
    if ($null -ne $load) { return [math]::Round([double]$load, 1) }
  } catch { }
  return $null
}

function Get-GpuLoad {
  # Contadores "GPU Engine" existem no Windows 10+ para qualquer fabricante
  # (AMD, Intel, NVIDIA) - e' a leitura de uso mais portavel que existe.
  try {
    $engines = Get-CimInstance -ClassName Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine -ErrorAction Stop
    if ($engines) {
      $total = ($engines | Where-Object { $_.Name -like '*engtype_3D*' } |
                Measure-Object -Property UtilizationPercentage -Sum).Sum
      if ($null -eq $total -or $total -eq 0) {
        $total = ($engines | Measure-Object -Property UtilizationPercentage -Sum).Sum
      }
      if ($null -ne $total) { return [math]::Min(100, [math]::Round([double]$total, 1)) }
    }
  } catch { }
  return $null
}

function Get-GpuMemory {
  try {
    $adapters = Get-CimInstance -ClassName Win32_PerfFormattedData_GPUPerformanceCounters_GPUAdapterMemory -ErrorAction Stop
    if ($adapters) {
      $used = ($adapters | Measure-Object -Property DedicatedUsage -Sum).Sum
      if ($used) { return [math]::Round([double]$used / 1MB, 0) }
    }
  } catch { }
  return $null
}

function Get-ThermalZoneTemp {
  # MSAcpi_ThermalZoneTemperature vem em decikelvin e nem toda placa-mae
  # expoe. Serve como aproximacao ate o LibreHardwareMonitor entrar.
  try {
    $zones = Get-CimInstance -Namespace 'root/wmi' -ClassName MSAcpi_ThermalZoneTemperature -ErrorAction Stop
    $values = @($zones | ForEach-Object { ($_.CurrentTemperature / 10.0) - 273.15 } |
                Where-Object { $_ -gt 5 -and $_ -lt 125 })
    if ($values.Count -gt 0) { return [math]::Round(($values | Measure-Object -Maximum).Maximum, 1) }
  } catch { }
  return $null
}

function Get-MemoryInfo {
  try {
    $os = Get-CimInstance -ClassName Win32_OperatingSystem -ErrorAction Stop
    $totalMb = [double]$os.TotalVisibleMemorySize / 1024
    $freeMb = [double]$os.FreePhysicalMemory / 1024
    return @{
      totalMb = [math]::Round($totalMb, 0)
      usedMb  = [math]::Round($totalMb - $freeMb, 0)
      percent = [math]::Round((($totalMb - $freeMb) / $totalMb) * 100, 1)
    }
  } catch { return $null }
}

function Get-DiskInfo {
  try {
    $drive = Get-CimInstance -ClassName Win32_LogicalDisk -Filter "DeviceID='C:'" -ErrorAction Stop
    if (-not $drive -or -not $drive.Size) { return $null }
    $totalGb = [double]$drive.Size / 1GB
    $freeGb = [double]$drive.FreeSpace / 1GB
    return @{
      totalGb = [math]::Round($totalGb, 1)
      usedGb  = [math]::Round($totalGb - $freeGb, 1)
      percent = [math]::Round((($totalGb - $freeGb) / $totalGb) * 100, 1)
    }
  } catch { return $null }
}

function Get-NetworkThroughput {
  try {
    $nics = Get-CimInstance -ClassName Win32_PerfFormattedData_Tcpip_NetworkInterface -ErrorAction Stop |
            Where-Object { $_.Name -notmatch 'Loopback|isatap|Teredo|Pseudo' }
    if (-not $nics) { return $null }
    return @{
      downKbps = [math]::Round((($nics | Measure-Object -Property BytesReceivedPersec -Sum).Sum * 8) / 1000, 0)
      upKbps   = [math]::Round((($nics | Measure-Object -Property BytesSentPersec -Sum).Sum * 8) / 1000, 0)
    }
  } catch { return $null }
}

function Get-Metrics {
  $uptime = $null
  try { $uptime = [math]::Round(((Get-Date) - (Get-CimInstance Win32_OperatingSystem).LastBootUpTime).TotalSeconds, 0) } catch { }
  return @{
    cpu = @{ load = Get-CpuLoad; temperature = Get-ThermalZoneTemp }
    gpu = @{ load = Get-GpuLoad; memoryMb = Get-GpuMemory; temperature = $null }
    memory = Get-MemoryInfo
    disk = Get-DiskInfo
    network = Get-NetworkThroughput
    uptimeSeconds = $uptime
  }
}

# ---------------------------------------------------------------------------
# Brilho do monitor (paineis internos / notebooks).
# ---------------------------------------------------------------------------
function Get-DisplayBrightness {
  try {
    $b = Get-CimInstance -Namespace 'root/wmi' -ClassName WmiMonitorBrightness -ErrorAction Stop | Select-Object -First 1
    if ($b) { return [int]$b.CurrentBrightness }
  } catch { }
  return $null
}

function Set-DisplayBrightness {
  param([int]$Percent)
  $value = [math]::Max(0, [math]::Min(100, $Percent))
  $methods = Get-CimInstance -Namespace 'root/wmi' -ClassName WmiMonitorBrightnessMethods -ErrorAction Stop | Select-Object -First 1
  if (-not $methods) { throw "este monitor nao expoe controle de brilho por software" }
  Invoke-CimMethod -InputObject $methods -MethodName WmiSetBrightness -Arguments @{ Timeout = 1; Brightness = $value } | Out-Null
  return @{ brightness = $value }
}

# ---------------------------------------------------------------------------
# Despacho de comandos.
# ---------------------------------------------------------------------------
$script:Handlers = @{
  'ping' = { param($p) @{ pong = $true; pid = $PID } }

  'hotkey' = { param($p) Invoke-Hotkey -Keys ([string]$p.keys) }

  'text' = { param($p)
    [Deck.Input]::TypeText([string]$p.value) | Out-Null
    @{ length = ([string]$p.value).Length }
  }

  'media' = { param($p)
    $map = @{ playpause = 'playpause'; next = 'nexttrack'; prev = 'prevtrack'; stop = 'stoptrack' }
    $name = $map[[string]$p.key]
    if (-not $name) { throw "tecla de midia invalida: $($p.key)" }
    Invoke-Hotkey -Keys $name
  }

  'windows.list' = { param($p)
    $windows = [Deck.Windows]::List()
    if ($p.filter) {
      $needle = ([string]$p.filter).ToLowerInvariant()
      $windows = @($windows | Where-Object {
        $_.Title.ToLowerInvariant().Contains($needle) -or $_.Process.ToLowerInvariant().Contains($needle)
      })
    }
    @{ windows = @($windows | ForEach-Object {
        @{ handle = $_.Handle; title = $_.Title; process = $_.Process
           pid = $_.ProcessId; foreground = $_.Foreground; minimized = $_.Minimized }
      }) }
  }

  'windows.activate' = { param($p)
    $handle = $null
    if ($p.handle) {
      $handle = [long]$p.handle
    } else {
      $needle = ([string]$p.match).ToLowerInvariant()
      if (-not $needle) { throw "informe 'handle' ou 'match'" }
      $all = [Deck.Windows]::List()
      # Preferir correspondencia pelo nome do processo: o titulo muda o tempo todo.
      $hit = @($all | Where-Object { $_.Process.ToLowerInvariant() -eq $needle }) |
             Select-Object -First 1
      if (-not $hit) { $hit = @($all | Where-Object { $_.Process.ToLowerInvariant().Contains($needle) }) | Select-Object -First 1 }
      if (-not $hit) { $hit = @($all | Where-Object { $_.Title.ToLowerInvariant().Contains($needle) }) | Select-Object -First 1 }
      if (-not $hit) { throw "nenhuma janela corresponde a '$($p.match)'" }
      $handle = $hit.Handle
    }
    @{ activated = [Deck.Windows]::Activate($handle); handle = $handle }
  }

  'windows.minimize' = { param($p) @{ ok = [Deck.Windows]::Minimize([long]$p.handle) } }
  'windows.close' = { param($p) @{ ok = [Deck.Windows]::Close([long]$p.handle) } }

  'desktop.switch' = { param($p)
    $keys = if ([string]$p.direction -eq 'prev') { 'ctrl+win+left' } else { 'ctrl+win+right' }
    Invoke-Hotkey -Keys $keys
  }

  'volume.get' = { param($p)
    $flow = if ([string]$p.device -eq 'input') { 1 } else { 0 }
    @{ device = $p.device; level = [math]::Round([Deck.Audio]::GetVolume($flow) * 100, 0); muted = [Deck.Audio]::GetMute($flow) }
  }

  'volume.set' = { param($p)
    $flow = if ([string]$p.device -eq 'input') { 1 } else { 0 }
    [Deck.Audio]::SetVolume($flow, [float]([double]$p.level / 100.0))
    @{ device = $p.device; level = [math]::Round([Deck.Audio]::GetVolume($flow) * 100, 0) }
  }

  'volume.adjust' = { param($p)
    $flow = if ([string]$p.device -eq 'input') { 1 } else { 0 }
    $next = ([Deck.Audio]::GetVolume($flow) * 100) + [double]$p.delta
    [Deck.Audio]::SetVolume($flow, [float]([math]::Max(0, [math]::Min(100, $next)) / 100.0))
    @{ device = $p.device; level = [math]::Round([Deck.Audio]::GetVolume($flow) * 100, 0) }
  }

  'volume.mute' = { param($p)
    $flow = if ([string]$p.device -eq 'input') { 1 } else { 0 }
    $target = if ($null -ne $p.muted) { [bool]$p.muted } else { -not [Deck.Audio]::GetMute($flow) }
    [Deck.Audio]::SetMute($flow, $target)
    @{ device = $p.device; muted = $target }
  }

  'display.brightness.get' = { param($p) @{ brightness = Get-DisplayBrightness } }
  'display.brightness.set' = { param($p) Set-DisplayBrightness -Percent ([int]$p.level) }

  'launch' = { param($p)
    $target = [string]$p.target
    if (-not $target) { throw "informe 'target'" }
    $splat = @{ FilePath = $target; ErrorAction = 'Stop' }
    if ($p.args) { $splat.ArgumentList = [string[]]@($p.args) }
    if ($p.workingDirectory) { $splat.WorkingDirectory = [string]$p.workingDirectory }
    Start-Process @splat | Out-Null
    @{ launched = $target }
  }

  'url' = { param($p)
    $value = [string]$p.value
    if ($value -notmatch '^(https?|mailto|ms-settings|steam|obsidian|spotify):') {
      throw "protocolo nao permitido"
    }
    Start-Process $value | Out-Null
    @{ opened = $value }
  }

  'system.lock' = { param($p)
    rundll32.exe user32.dll,LockWorkStation
    @{ locked = $true }
  }

  'system.sleep' = { param($p)
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.Application]::SetSuspendState('Suspend', $false, $false) | Out-Null
    @{ sleeping = $true }
  }

  'system.monitors.off' = { param($p)
    [Deck.Power]::MonitorsOff()
    @{ monitorsOff = $true }
  }

  'metrics' = { param($p) Get-Metrics }
}

# ---------------------------------------------------------------------------
# Laco principal: uma requisicao JSON por linha.
# ---------------------------------------------------------------------------
[Console]::Error.WriteLine("deck-agent pronto (pid $PID)")

while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  if ([string]::IsNullOrWhiteSpace($line)) { continue }

  $requestId = $null
  try {
    $request = $line | ConvertFrom-Json
    $requestId = $request.id
    $handler = $script:Handlers[[string]$request.command]
    if (-not $handler) { throw "comando desconhecido: $($request.command)" }
    $params = if ($null -ne $request.params) { $request.params } else { [pscustomobject]@{} }
    $result = & $handler $params
    $response = @{ id = $requestId; ok = $true; result = $result }
  } catch {
    $response = @{ id = $requestId; ok = $false; error = $_.Exception.Message }
  }

  [Console]::Out.WriteLine(($response | ConvertTo-Json -Depth 8 -Compress))
  [Console]::Out.Flush()
}
