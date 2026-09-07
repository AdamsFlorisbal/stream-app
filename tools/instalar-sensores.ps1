<#
.SYNOPSIS
    Instala e configura o LibreHardwareMonitor para leitura de temperaturas.

.DESCRIPTION
    O Windows nao expoe sensores termicos por API publica: os valores vivem em
    chips da placa-mae e em registradores da CPU/GPU, acessiveis apenas em modo
    kernel. O LibreHardwareMonitor carrega o driver que faz isso e publica tudo
    em http://localhost:8085/data.json, de onde o Deck Control le.

    Este script:
      1. baixa a ultima versao do LibreHardwareMonitor (com sua confirmacao);
      2. configura o servidor web na porta 8085, iniciando minimizado;
      3. registra uma tarefa agendada que o inicia com privilegio elevado no
         logon - assim o UAC nao aparece a cada reinicio do computador;
      4. inicia o programa imediatamente.

    O passo 3 exige privilegios de administrador. Se o script for executado sem
    eles, ele se re-executa elevado uma unica vez.

.PARAMETER Port
    Porta do servidor web do LibreHardwareMonitor. Padrao: 8085.

.PARAMETER Yes
    Aceita o download sem perguntar.

.PARAMETER Remove
    Remove a tarefa agendada (nao apaga os arquivos).

.EXAMPLE
    .\instalar-sensores.ps1
    .\instalar-sensores.ps1 -Yes
    .\instalar-sensores.ps1 -Remove
#>

[CmdletBinding()]
param(
    [int]$Port = 8085,
    [switch]$Yes,
    [switch]$Remove
)

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$TaskName  = 'DeckControl-Sensores'
$ToolsRoot = Join-Path $PSScriptRoot '..\server\data\tools'
$Dest      = Join-Path $ToolsRoot 'LibreHardwareMonitor'
$Exe       = Join-Path $Dest 'LibreHardwareMonitor.exe'
$ApiUrl    = 'https://api.github.com/repos/LibreHardwareMonitor/LibreHardwareMonitor/releases/latest'

function Write-Step {
    param([string]$Text, [string]$Color = 'Cyan')
    Write-Host "  $Text" -ForegroundColor $Color
}

function Test-Admin {
    $id = [Security.Principal.WindowsIdentity]::GetCurrent()
    return (New-Object Security.Principal.WindowsPrincipal($id)).IsInRole(
        [Security.Principal.WindowsBuiltInRole]::Administrator)
}

# ---------------------------------------------------------------------------

Write-Host ''
Write-Host '  DECK CONTROL - sensores de temperatura' -ForegroundColor Cyan
Write-Host '  --------------------------------------' -ForegroundColor DarkGray

if ($Remove) {
    if (-not (Test-Admin)) { throw 'para remover a tarefa, execute como administrador' }
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
    Write-Step 'Inicializacao automatica removida.' 'Yellow'
    exit 0
}

# --- 1. Download -----------------------------------------------------------

if (Test-Path $Exe) {
    Write-Step "LibreHardwareMonitor ja presente em $Dest" 'Green'
} else {
    Write-Host ''
    Write-Host '  O LibreHardwareMonitor nao foi encontrado.' -ForegroundColor Yellow
    Write-Host '  Origem: github.com/LibreHardwareMonitor/LibreHardwareMonitor (releases)' -ForegroundColor DarkGray
    Write-Host "  Destino: $Dest" -ForegroundColor DarkGray
    Write-Host ''
    if (-not $Yes) {
        $answer = Read-Host '  Baixar agora? (s/N)'
        if ($answer -notmatch '^[sSyY]') {
            Write-Step 'Cancelado. A telemetria segue funcionando sem temperaturas.' 'Yellow'
            exit 1
        }
    }

    $release = Invoke-RestMethod -Uri $ApiUrl -Headers @{ 'User-Agent' = 'deck-control' } -TimeoutSec 30
    # Preferir o build classico (.NET Framework), presente em todo Windows. O
    # build ".NET 10" so' roda se aquele runtime estiver instalado.
    $asset = $release.assets | Where-Object { $_.name -match '\.zip$' -and $_.name -notmatch 'NET' } |
             Select-Object -First 1
    if (-not $asset) {
        $asset = $release.assets | Where-Object { $_.name -match '\.zip$' } | Select-Object -First 1
    }

    Write-Step "Baixando $($asset.name) ($([math]::Round($asset.size/1MB,1)) MB) da $($release.tag_name)..."
    New-Item -ItemType Directory -Force -Path $ToolsRoot | Out-Null
    $zip = Join-Path $ToolsRoot 'lhm.zip'
    Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $zip -UseBasicParsing -TimeoutSec 300

    Write-Step 'Extraindo...'
    Expand-Archive -Path $zip -DestinationPath $Dest -Force
    [System.IO.File]::Delete($zip)
    if (-not (Test-Path $Exe)) { throw 'a extracao terminou, mas o executavel nao apareceu' }
    Write-Step "Instalado em $Dest" 'Green'
}

# --- 2. Configuracao -------------------------------------------------------

$config = Join-Path $Dest 'LibreHardwareMonitor.config'
$xml = @"
<?xml version="1.0" encoding="utf-8"?>
<configuration>
  <appSettings>
    <add key="listenerPort" value="$Port" />
    <add key="runWebServerMenuItem" value="true" />
    <add key="minTrayMenuItem" value="true" />
    <add key="minCloseMenuItem" value="true" />
    <add key="startMinMenuItem" value="true" />
    <add key="cpuMenuItem" value="true" />
    <add key="gpuMenuItem" value="true" />
    <add key="mainboardMenuItem" value="true" />
    <add key="ramMenuItem" value="true" />
    <add key="hddMenuItem" value="true" />
    <add key="temperatureMenuItem" value="true" />
    <add key="fanMenuItem" value="true" />
    <add key="loadMenuItem" value="true" />
  </appSettings>
</configuration>
"@
[System.IO.File]::WriteAllText($config, $xml, [System.Text.UTF8Encoding]::new($false))
Write-Step "Servidor web configurado na porta $Port" 'Green'

# --- 3. Inicializacao automatica (exige administrador) ---------------------

if (-not (Test-Admin)) {
    Write-Host ''
    Write-Step 'A tarefa agendada exige administrador. Elevando...' 'Yellow'
    $args = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"",
              '-Port', $Port, '-Yes')
    Start-Process -FilePath 'powershell.exe' -ArgumentList $args -Verb RunAs
    exit 0
}

$action = New-ScheduledTaskAction -Execute $Exe -WorkingDirectory $Dest
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero)

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
    -Principal $principal -Settings $settings `
    -Description 'Inicia o LibreHardwareMonitor elevado, para o Deck Control ler temperaturas.' `
    -Force | Out-Null

Write-Step "Tarefa '$TaskName' registrada (logon, privilegio elevado)" 'Green'

# --- 4. Iniciar agora ------------------------------------------------------

if (-not (Get-Process -Name 'LibreHardwareMonitor' -ErrorAction SilentlyContinue)) {
    Start-ScheduledTask -TaskName $TaskName
    Write-Step 'Iniciado.'
} else {
    Write-Step 'Ja esta em execucao.'
}

Write-Host ''
Write-Host '  Verificando os sensores...' -ForegroundColor DarkGray
$ok = $false
for ($i = 0; $i -lt 20; $i++) {
    Start-Sleep -Seconds 2
    try {
        $r = Invoke-WebRequest "http://127.0.0.1:$Port/data.json" -UseBasicParsing -TimeoutSec 4
        if ($r.StatusCode -eq 200) { $ok = $true; break }
    } catch { }
}

Write-Host ''
if ($ok) {
    Write-Host "  Pronto. Sensores publicados em http://localhost:$Port/data.json" -ForegroundColor Green
    Write-Host '  O Deck Control passa a mostrar as temperaturas em ate 1 segundo.' -ForegroundColor DarkGray
} else {
    Write-Host "  O servidor web nao respondeu na porta $Port." -ForegroundColor Yellow
    Write-Host '  Abra o LibreHardwareMonitor e marque Options > Remote Web Server > Run.' -ForegroundColor DarkGray
}
Write-Host ''
