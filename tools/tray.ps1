# ============================================================================
#  Deck Control - Bandeja do sistema
#
#  Interface grafica minima (WinForms) que fica no icone da bandeja do Windows
#  e cuida do processo do servidor: iniciar, parar, reiniciar e abrir o painel
#  no navegador. Nunca deixa uma janela de console visivel.
#
#  Uso tipico: dois cliques em "iniciar-bandeja.vbs", na raiz do projeto, no
#  lugar de "iniciar.bat". Para rodar de forma visivel (depuracao):
#    powershell -NoProfile -ExecutionPolicy Bypass -File tools\tray.ps1
#
#  Por que parar via HTTP em vez de fechar o processo: o servidor so' salva as
#  ultimas edicoes pendentes (perfis, configuracao) quando recebe SIGINT/SIGTERM
#  de forma graciosa. Um processo sem console nao recebe Ctrl+C, entao a rota
#  POST /api/system/shutdown existe justamente para isso — ela roda o mesmo
#  caminho de encerramento que o Ctrl+C do terminal.
# ============================================================================

$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

Add-Type -Namespace DeckControl -Name NativeIcon -MemberDefinition @'
[DllImport("user32.dll")]
public static extern bool DestroyIcon(IntPtr handle);
'@

# --- Instancia unica --------------------------------------------------------

$mutex = New-Object System.Threading.Mutex($false, 'DeckControlTrayMutex')
if (-not $mutex.WaitOne(0, $false)) {
  [System.Windows.Forms.MessageBox]::Show(
    'O Deck Control ja esta na bandeja (veja os icones ocultos, perto do relogio).',
    'Deck Control', [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Information
  ) | Out-Null
  exit 0
}

# --- Caminhos -----------------------------------------------------------

$RepoRoot  = Resolve-Path (Join-Path $PSScriptRoot '..')
$ServerDir = Join-Path $RepoRoot 'server'
$DataDir   = Join-Path $ServerDir 'data'
$OutLog    = Join-Path $DataDir 'server.log'
$ErrLog    = Join-Path $DataDir 'server.err.log'
$SettingsFile = Join-Path $DataDir 'settings.json'
$LauncherVbs  = Join-Path $RepoRoot 'iniciar-bandeja.vbs'
$TaskName  = 'DeckControl-Bandeja'

New-Item -ItemType Directory -Force -Path $DataDir | Out-Null

# --- Estado ------------------------------------------------------------

$script:State = 'checking'          # checking | starting | running | stopping | stopped | error
$script:NodeProcess = $null
$script:Port = 8787
$script:Pin = $null
$script:BaseUrl = 'http://127.0.0.1:8787'
$script:LanUrl = $null
$script:Hostname = $null
$script:StoppingIntentionally = $false
$script:PendingRestart = $false
$script:StartDeadline = Get-Date
$script:StopDeadline = Get-Date
$script:CurrentIconHandle = $null

function Update-DeckSettings {
  $port = 8787
  $pin = $null
  if (Test-Path $SettingsFile) {
    try {
      $json = Get-Content $SettingsFile -Raw -Encoding UTF8 | ConvertFrom-Json
      if ($json.server.port) { $port = [int]$json.server.port }
      if ($json.security.pin) { $pin = [string]$json.security.pin }
    } catch { }
  }
  $script:Port = $port
  $script:Pin = $pin
  $script:BaseUrl = "http://127.0.0.1:$port"
}
Update-DeckSettings

function Write-DeckLog {
  param([string]$Text)
  try {
    $stamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
    Add-Content -Path $OutLog -Value "[$stamp] [bandeja] $Text" -Encoding UTF8
  } catch { }
}

function Invoke-Safe {
  param([scriptblock]$Action)
  try {
    & $Action | Out-Null
  } catch {
    Write-DeckLog "erro: $($_.Exception.Message)"
    try {
      $notifyIcon.ShowBalloonTip(4000, 'Deck Control', $_.Exception.Message, [System.Windows.Forms.ToolTipIcon]::Error)
    } catch { }
  }
}

# --- Icone desenhado em tempo real (nada de arquivo .ico externo) ----------
# Mini grade de 4 quadrados nas cores da propria interface (ciano/roxo/rosa/
# verde), com um ponto de status no canto — mesma linguagem visual dos badges
# do topo do painel.

function New-TrayIcon {
  param([string]$Status = 'stopped')

  $bmp = New-Object System.Drawing.Bitmap 32, 32
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.Clear([System.Drawing.Color]::Transparent)

  $bgBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 13, 17, 23))
  $g.FillRectangle($bgBrush, 1, 1, 30, 30)
  $bgBrush.Dispose()

  $active = $Status -in @('running', 'starting')
  if ($active) {
    $palette = @(
      [System.Drawing.Color]::FromArgb(255, 34, 211, 238),
      [System.Drawing.Color]::FromArgb(255, 167, 139, 250),
      [System.Drawing.Color]::FromArgb(255, 244, 114, 182),
      [System.Drawing.Color]::FromArgb(255, 52, 211, 153)
    )
  } else {
    $gray = [System.Drawing.Color]::FromArgb(255, 72, 80, 95)
    $palette = @($gray, $gray, $gray, $gray)
  }

  $cell = 11; $gap = 2; $ox = 5; $oy = 5
  $coords = @(@(0, 0), @(1, 0), @(0, 1), @(1, 1))
  for ($i = 0; $i -lt 4; $i++) {
    $b = New-Object System.Drawing.SolidBrush $palette[$i]
    $x = $ox + $coords[$i][0] * ($cell + $gap)
    $y = $oy + $coords[$i][1] * ($cell + $gap)
    $g.FillRectangle($b, $x, $y, $cell, $cell)
    $b.Dispose()
  }

  $dotColor = switch ($Status) {
    'running'  { [System.Drawing.Color]::FromArgb(255, 52, 211, 153) }
    'starting' { [System.Drawing.Color]::FromArgb(255, 251, 191, 36) }
    'stopping' { [System.Drawing.Color]::FromArgb(255, 251, 191, 36) }
    'error'    { [System.Drawing.Color]::FromArgb(255, 239, 68, 68) }
    default    { [System.Drawing.Color]::FromArgb(255, 100, 108, 122) }
  }
  $ring = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 13, 17, 23))
  $g.FillEllipse($ring, 20, 20, 10, 10)
  $ring.Dispose()
  $dot = New-Object System.Drawing.SolidBrush $dotColor
  $g.FillEllipse($dot, 21, 21, 8, 8)
  $dot.Dispose()

  $g.Dispose()
  $handle = $bmp.GetHicon()
  $bmp.Dispose()
  $icon = [System.Drawing.Icon]::FromHandle($handle)
  return [pscustomobject]@{ Icon = $icon; Handle = $handle }
}

# --- Bandeja e menu ----------------------------------------------------

$notifyIcon = New-Object System.Windows.Forms.NotifyIcon
$notifyIcon.Text = 'Deck Control'
$notifyIcon.Visible = $true

$menu = New-Object System.Windows.Forms.ContextMenuStrip
$itemStatus = $menu.Items.Add('Verificando...')
$itemStatus.Enabled = $false
[void]$menu.Items.Add('-')
$itemOpen = $menu.Items.Add('Abrir painel')
$itemOpen.Font = New-Object System.Drawing.Font($itemOpen.Font, [System.Drawing.FontStyle]::Bold)
$itemToggle = $menu.Items.Add('Iniciar servidor')
$itemRestart = $menu.Items.Add('Reiniciar servidor')
[void]$menu.Items.Add('-')
$itemCopy = $menu.Items.Add('Copiar endereco da rede')
$itemFolder = $menu.Items.Add('Abrir pasta de dados')
$itemLog = $menu.Items.Add('Ver log')
[void]$menu.Items.Add('-')
$itemAutostart = $menu.Items.Add('Iniciar com o Windows')
[void]$menu.Items.Add('-')
$itemExit = $menu.Items.Add('Sair (nao para o servidor)')

$notifyIcon.ContextMenuStrip = $menu

# --- Servidor: saude, info, ciclo de vida -------------------------------

function Test-DeckHealth {
  try {
    $resp = Invoke-RestMethod -Uri "$script:BaseUrl/api/health" -TimeoutSec 2 -ErrorAction Stop
    return [bool]$resp.ok
  } catch {
    return $false
  }
}

function Get-DeckServerInfo {
  try {
    $resp = Invoke-RestMethod -Uri "$script:BaseUrl/api/state" -TimeoutSec 3 -ErrorAction Stop
    $script:Hostname = $resp.server.hostname
    $wifi = $resp.server.addresses | Select-Object -First 1
    if ($wifi) { $script:LanUrl = "http://$($wifi.address):$($resp.server.port)" }
  } catch { }
}

function Get-DeckServerPid {
  try {
    $conn = Get-NetTCPConnection -LocalPort $script:Port -State Listen -ErrorAction Stop | Select-Object -First 1
    if ($conn) { return $conn.OwningProcess }
  } catch { }
  return $null
}

function Start-DeckServer {
  if ($script:State -in @('starting', 'running')) { return }
  Update-DeckSettings
  $script:State = 'starting'
  $script:StartDeadline = (Get-Date).AddSeconds(20)
  Update-Tray

  $node = Get-Command node -ErrorAction SilentlyContinue
  if (-not $node) {
    Write-DeckLog 'node.js nao encontrado no PATH'
    $script:State = 'error'
    $notifyIcon.ShowBalloonTip(6000, 'Deck Control', 'Node.js nao encontrado. Instale em nodejs.org e tente de novo.', [System.Windows.Forms.ToolTipIcon]::Error)
    Update-Tray
    return
  }

  if (-not (Test-Path (Join-Path $ServerDir 'node_modules'))) {
    $notifyIcon.Text = 'Deck Control - instalando dependencias...'
    $npm = Start-Process -FilePath 'cmd.exe' -ArgumentList '/c "npm install --no-audit --no-fund"' `
      -WorkingDirectory $ServerDir -WindowStyle Hidden -Wait -PassThru
    if ($npm.ExitCode -ne 0) {
      Write-DeckLog 'npm install falhou'
      $script:State = 'error'
      $notifyIcon.ShowBalloonTip(6000, 'Deck Control', 'Falha ao instalar dependencias (npm install). Rode iniciar.bat uma vez para ver o erro.', [System.Windows.Forms.ToolTipIcon]::Error)
      Update-Tray
      return
    }
  }

  "==== $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') iniciado pela bandeja ====" | Set-Content -Path $OutLog -Encoding UTF8
  "==== $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') iniciado pela bandeja ====" | Set-Content -Path $ErrLog -Encoding UTF8

  $proc = Start-Process -FilePath $node.Source -ArgumentList 'src/main.js' -WorkingDirectory $ServerDir `
    -WindowStyle Hidden -RedirectStandardOutput $OutLog -RedirectStandardError $ErrLog -PassThru
  $script:NodeProcess = $proc
}

function Invoke-ForceStop {
  $targetPid = $null
  if ($script:NodeProcess -and -not $script:NodeProcess.HasExited) { $targetPid = $script:NodeProcess.Id }
  if (-not $targetPid) { $targetPid = Get-DeckServerPid }
  if ($targetPid) {
    Write-DeckLog "forcando encerramento do processo $targetPid (nao respondeu ao pedido gracioso)"
    Start-Process -FilePath 'taskkill.exe' -ArgumentList "/PID $targetPid /T /F" -WindowStyle Hidden -Wait
  }
}

function Stop-DeckServer {
  param([switch]$Restarting)

  if ($script:State -eq 'stopped') {
    if ($Restarting) { Start-DeckServer }
    return
  }

  $script:State = 'stopping'
  $script:StoppingIntentionally = $true
  $script:PendingRestart = [bool]$Restarting
  $script:StopDeadline = (Get-Date).AddSeconds(6)
  Update-Tray

  try {
    $headers = @{}
    if ($script:Pin) { $headers['X-Deck-Pin'] = $script:Pin }
    Invoke-RestMethod -Uri "$script:BaseUrl/api/system/shutdown" -Method Post -ContentType 'application/json' `
      -Body '{}' -Headers $headers -TimeoutSec 3 -ErrorAction Stop | Out-Null
  } catch {
    # servidor pode ja estar caido, ou nao respondeu a tempo -- a sincronizacao
    # periodica confirma o estado e forca o encerramento se preciso.
  }
}

function Restart-DeckServer {
  Stop-DeckServer -Restarting
}

function Open-Panel {
  $url = if ($script:LanUrl) { $script:LanUrl } else { "http://127.0.0.1:$script:Port" }
  Start-Process $url
}

# --- Inicializar com o Windows (tarefa agendada, sem exigir admin) ---------

function Test-AutostartEnabled {
  return [bool](Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue)
}

function Enable-Autostart {
  $action = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument "`"$LauncherVbs`"" -WorkingDirectory $RepoRoot
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings `
    -Description 'Abre o Deck Control na bandeja do sistema ao entrar no Windows.' -Force | Out-Null
}

function Disable-Autostart {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
}

# --- Atualizacao da interface --------------------------------------------

function Update-Tray {
  $iconStatus = if ($script:State -in @('running', 'starting', 'stopping', 'error')) { $script:State } else { 'stopped' }
  $made = New-TrayIcon -Status $iconStatus
  $oldIcon = $notifyIcon.Icon
  $oldHandle = $script:CurrentIconHandle
  $notifyIcon.Icon = $made.Icon
  $script:CurrentIconHandle = $made.Handle
  if ($oldHandle) { try { [void][DeckControl.NativeIcon]::DestroyIcon($oldHandle) } catch { } }
  if ($oldIcon) { try { $oldIcon.Dispose() } catch { } }

  $label = switch ($script:State) {
    'running'  { 'Rodando' }
    'starting' { 'Iniciando...' }
    'stopping' { 'Parando...' }
    'error'    { 'Erro' }
    'checking' { 'Verificando...' }
    default    { 'Parado' }
  }

  $tooltip = "Deck Control - $label"
  if ($script:State -eq 'running' -and $script:LanUrl) { $tooltip = "Deck Control - $label`n$script:LanUrl" }
  if ($tooltip.Length -gt 63) { $tooltip = $tooltip.Substring(0, 63) }
  $notifyIcon.Text = $tooltip

  $itemStatus.Text = "Status: $label"
  $itemToggle.Text = if ($script:State -in @('running', 'starting')) { 'Parar servidor' } else { 'Iniciar servidor' }
  $itemToggle.Enabled = $script:State -in @('running', 'stopped', 'error')
  $itemRestart.Enabled = $script:State -eq 'running'
  $itemOpen.Enabled = $script:State -eq 'running'
  $itemCopy.Enabled = ($script:State -eq 'running') -and [bool]$script:LanUrl
  $itemAutostart.Checked = Test-AutostartEnabled
}

function Sync-TrayState {
  try {
    if ($script:NodeProcess -and $script:NodeProcess.HasExited) { $script:NodeProcess = $null }
    $healthy = Test-DeckHealth

    switch ($script:State) {
      'starting' {
        if ($healthy) {
          $script:State = 'running'
          Get-DeckServerInfo
          $suffix = if ($script:LanUrl) { " $script:LanUrl" } else { '' }
          $notifyIcon.ShowBalloonTip(4000, 'Deck Control', "Servidor pronto.$suffix", [System.Windows.Forms.ToolTipIcon]::Info)
        } elseif ((Get-Date) -gt $script:StartDeadline) {
          $script:State = 'error'
          $notifyIcon.ShowBalloonTip(6000, 'Deck Control', 'O servidor nao respondeu ao iniciar. Veja o log.', [System.Windows.Forms.ToolTipIcon]::Error)
        }
      }
      'running' {
        if (-not $healthy) {
          if ($script:PendingRestart) {
            $script:PendingRestart = $false
            $script:StoppingIntentionally = $false
            Start-DeckServer
          } elseif ($script:StoppingIntentionally) {
            $script:StoppingIntentionally = $false
            $script:State = 'stopped'
            $notifyIcon.ShowBalloonTip(3000, 'Deck Control', 'Servidor parado.', [System.Windows.Forms.ToolTipIcon]::Info)
          } else {
            $script:State = 'stopped'
            $notifyIcon.ShowBalloonTip(6000, 'Deck Control', 'O servidor parou inesperadamente.', [System.Windows.Forms.ToolTipIcon]::Warning)
          }
        }
      }
      'stopping' {
        if (-not $healthy) {
          if ($script:PendingRestart) {
            $script:PendingRestart = $false
            $script:StoppingIntentionally = $false
            Start-DeckServer
          } else {
            $script:StoppingIntentionally = $false
            $script:State = 'stopped'
            $notifyIcon.ShowBalloonTip(3000, 'Deck Control', 'Servidor parado.', [System.Windows.Forms.ToolTipIcon]::Info)
          }
        } elseif ((Get-Date) -gt $script:StopDeadline) {
          Invoke-ForceStop
          $script:StopDeadline = (Get-Date).AddSeconds(4)
        }
      }
      'stopped' {
        if ($healthy) {
          # alguem ligou o servidor por fora (iniciar.bat, outra instancia) --
          # a bandeja passa a monitora-lo mesmo sem te-lo iniciado.
          $script:State = 'running'
          Get-DeckServerInfo
        }
      }
      'error' {
        if ($healthy) {
          $script:State = 'running'
          Get-DeckServerInfo
        }
      }
    }

    Update-Tray
  } catch {
    Write-DeckLog "erro no ciclo de sincronizacao: $($_.Exception.Message)"
  }
}

# --- Eventos do menu -----------------------------------------------------

$notifyIcon.add_MouseUp({
  param($sender, $e)
  if ($e.Button -eq [System.Windows.Forms.MouseButtons]::Left) { $menu.Show([System.Windows.Forms.Cursor]::Position) }
})
$notifyIcon.add_MouseDoubleClick({
  param($sender, $e)
  if ($e.Button -eq [System.Windows.Forms.MouseButtons]::Left) { Invoke-Safe { Open-Panel } }
})

$itemOpen.add_Click({ Invoke-Safe { Open-Panel } })
$itemToggle.add_Click({
  Invoke-Safe {
    if ($script:State -in @('running', 'starting')) { Stop-DeckServer } else { Start-DeckServer }
  }
})
$itemRestart.add_Click({ Invoke-Safe { Restart-DeckServer } })

$itemCopy.add_Click({
  Invoke-Safe {
    if ($script:LanUrl) {
      [System.Windows.Forms.Clipboard]::SetText($script:LanUrl)
      $notifyIcon.ShowBalloonTip(2500, 'Deck Control', "Endereco copiado: $script:LanUrl", [System.Windows.Forms.ToolTipIcon]::Info)
    }
  }
})
$itemFolder.add_Click({ Invoke-Safe { Start-Process explorer.exe $DataDir } })
$itemLog.add_Click({
  Invoke-Safe {
    $opened = $false
    if (Test-Path $OutLog) { Start-Process notepad.exe $OutLog; $opened = $true }
    if (Test-Path $ErrLog) { Start-Process notepad.exe $ErrLog; $opened = $true }
    if (-not $opened) {
      [System.Windows.Forms.MessageBox]::Show('Nenhum log ainda.', 'Deck Control', [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Information) | Out-Null
    }
  }
})

$itemAutostart.add_Click({
  Invoke-Safe {
    if (Test-AutostartEnabled) { Disable-Autostart } else { Enable-Autostart }
    $itemAutostart.Checked = Test-AutostartEnabled
  }
})

$itemExit.add_Click({
  $notifyIcon.Visible = $false
  try { $mutex.ReleaseMutex() } catch { }
  [System.Windows.Forms.Application]::Exit()
})

# --- Partida -------------------------------------------------------------

try {
  Update-Tray
  if (Test-DeckHealth) {
    $script:State = 'running'
    Get-DeckServerInfo
  } else {
    Start-DeckServer
  }
  Update-Tray

  $timer = New-Object System.Windows.Forms.Timer
  $timer.Interval = 2500
  $timer.add_Tick({ Sync-TrayState })
  $timer.Start()

  [System.Windows.Forms.Application]::Run()
} finally {
  $notifyIcon.Visible = $false
  try { $mutex.ReleaseMutex() } catch { }
}
