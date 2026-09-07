<#
.SYNOPSIS
    Prepara a conexao do tablet por cabo USB.

.DESCRIPTION
    Usa `adb reverse` para que o tablet alcance o servidor do PC pelo cabo.
    O Android encaminha a porta local dele para a mesma porta no PC, entao o
    aplicativo simplesmente abre http://127.0.0.1:8787 - sem Wi-Fi e sem IP.

    Se o adb nao estiver instalado, o script se oferece para baixar o pacote
    oficial Android Platform Tools do Google. O download so' acontece com sua
    confirmacao (ou com -Yes).

.PARAMETER Port
    Porta HTTP do servidor. Padrao: 8787.

.PARAMETER Yes
    Aceita o download do Platform Tools sem perguntar.

.PARAMETER Remove
    Desfaz o redirecionamento em vez de cria-lo.

.EXAMPLE
    .\usb-connect.ps1
    .\usb-connect.ps1 -Port 9000 -Yes
    .\usb-connect.ps1 -Remove
#>

[CmdletBinding()]
param(
    [int]$Port = 8787,
    [switch]$Yes,
    [switch]$Remove
)

$ErrorActionPreference = 'Stop'

$DownloadUrl = 'https://dl.google.com/android/repository/platform-tools-latest-windows.zip'
$ToolsRoot = Join-Path $PSScriptRoot '..\server\data\tools'
$LocalAdb = Join-Path $ToolsRoot 'platform-tools\adb.exe'

function Write-Step {
    param([string]$Text, [string]$Color = 'Cyan')
    Write-Host "  $Text" -ForegroundColor $Color
}

function Find-Adb {
    $candidates = @(
        $LocalAdb,
        (Join-Path $env:LOCALAPPDATA 'Android\Sdk\platform-tools\adb.exe'),
        (Join-Path $env:ProgramFiles 'Android\platform-tools\adb.exe'),
        'C:\platform-tools\adb.exe'
    )
    foreach ($candidate in $candidates) {
        if ($candidate -and (Test-Path $candidate)) { return (Resolve-Path $candidate).Path }
    }
    $onPath = Get-Command adb -ErrorAction SilentlyContinue
    if ($onPath) { return $onPath.Source }
    return $null
}

function Install-PlatformTools {
    Write-Host ''
    Write-Host '  O adb (Android Platform Tools) nao foi encontrado.' -ForegroundColor Yellow
    Write-Host "  Origem do download: $DownloadUrl" -ForegroundColor DarkGray
    Write-Host "  Destino:            $ToolsRoot" -ForegroundColor DarkGray
    Write-Host '  Sao cerca de 15 MB, direto do servidor oficial do Google.' -ForegroundColor DarkGray
    Write-Host ''

    if (-not $Yes) {
        $answer = Read-Host '  Baixar agora? (s/N)'
        if ($answer -notmatch '^[sSyY]') {
            Write-Step 'Cancelado. Voce ainda pode usar a conexao por Wi-Fi.' 'Yellow'
            return $null
        }
    }

    New-Item -ItemType Directory -Force -Path $ToolsRoot | Out-Null
    $zip = Join-Path $ToolsRoot 'platform-tools.zip'

    Write-Step 'Baixando...'
    Invoke-WebRequest -Uri $DownloadUrl -OutFile $zip -UseBasicParsing

    Write-Step 'Extraindo...'
    Expand-Archive -Path $zip -DestinationPath $ToolsRoot -Force
    Remove-Item $zip -Force

    if (Test-Path $LocalAdb) {
        Write-Step "Instalado em $LocalAdb" 'Green'
        return $LocalAdb
    }
    throw 'a extracao terminou, mas o adb.exe nao apareceu onde era esperado'
}

# ---------------------------------------------------------------------------

Write-Host ''
Write-Host '  DECK CONTROL - conexao por cabo USB' -ForegroundColor Cyan
Write-Host '  ------------------------------------' -ForegroundColor DarkGray

$adb = Find-Adb
if (-not $adb) {
    $adb = Install-PlatformTools
    if (-not $adb) { exit 1 }
} else {
    Write-Step "adb encontrado: $adb" 'Green'
}

# O daemon do adb sobe na primeira chamada e anuncia isso pelo stderr. No
# PowerShell 5.1, capturar stderr de um executavel nativo com `2>&1` embrulha
# cada linha em um ErrorRecord e, com ErrorActionPreference='Stop', aborta o
# script. Por isso o stderr nunca e' redirecionado aqui.
& $adb start-server | Out-Null

if ($Remove) {
    & $adb reverse --remove "tcp:$Port" | Out-Null
    Write-Step "Redirecionamento da porta $Port removido." 'Yellow'
    exit 0
}

function Get-AdbDevices {
    $devices = @()
    foreach ($line in (& $adb devices | Select-Object -Skip 1)) {
        if (-not $line.Trim()) { continue }
        $parts = $line -split '\s+'
        if ($parts.Count -ge 2) {
            $devices += [pscustomobject]@{ Serial = $parts[0]; State = $parts[1] }
        }
    }
    return $devices
}

Write-Step 'Procurando aparelhos...'
$devices = Get-AdbDevices

# "authorizing" significa que o dialogo de permissao esta aberto no tablet.
# E' um estado transitorio: vale esperar o toque em vez de falhar na hora.
if (($devices | Where-Object { $_.State -eq 'authorizing' })) {
    Write-Host ''
    Write-Host '  Olhe a tela do tablet: toque em "Permitir" para autorizar este PC.' -ForegroundColor Yellow
    Write-Host '  (marque "Sempre permitir deste computador" para nao repetir)' -ForegroundColor DarkGray
    Write-Host ''
    for ($i = 0; $i -lt 30; $i++) {
        Start-Sleep -Seconds 2
        $devices = Get-AdbDevices
        if (-not ($devices | Where-Object { $_.State -eq 'authorizing' })) { break }
        Write-Host '.' -NoNewline -ForegroundColor DarkGray
    }
    Write-Host ''
}

if ($devices.Count -eq 0) {
    Write-Host ''
    Write-Host '  Nenhum aparelho conectado.' -ForegroundColor Yellow
    Write-Host '  No tablet, verifique:' -ForegroundColor DarkGray
    Write-Host '    1. Configuracoes > Sobre o tablet > toque 7x em "Numero da versao"' -ForegroundColor DarkGray
    Write-Host '    2. Opcoes do desenvolvedor > ative "Depuracao USB"' -ForegroundColor DarkGray
    Write-Host '    3. Reconecte o cabo e autorize este computador na tela do tablet' -ForegroundColor DarkGray
    Write-Host ''
    exit 1
}

$blocked = $devices | Where-Object { $_.State -in @('unauthorized', 'authorizing') }
if ($blocked) {
    Write-Host ''
    Write-Host '  Aparelho conectado, mas ainda nao autorizado.' -ForegroundColor Yellow
    Write-Host '  Toque em "Permitir depuracao USB" na tela do tablet e rode de novo.' -ForegroundColor DarkGray
    Write-Host '  Se o aviso nao aparecer: Opcoes do desenvolvedor > "Revogar autorizacoes' -ForegroundColor DarkGray
    Write-Host '  de depuracao USB", depois reconecte o cabo.' -ForegroundColor DarkGray
    Write-Host ''
    exit 1
}

$ready = $devices | Where-Object { $_.State -eq 'device' }
if (-not $ready) {
    Write-Host ''
    Write-Host "  Aparelho em estado inesperado: $($devices[0].State)" -ForegroundColor Yellow
    Write-Host ''
    exit 1
}
foreach ($device in $ready) {
    & $adb -s $device.Serial reverse "tcp:$Port" "tcp:$Port" | Out-Null
    Write-Step "Ponte ativa em $($device.Serial)" 'Green'
}

Write-Host ''
Write-Host '  Pronto. No tablet, abra:' -ForegroundColor Green
Write-Host "    http://127.0.0.1:$Port" -ForegroundColor White
Write-Host ''
Write-Host '  O aplicativo Deck Control encontra esse endereco sozinho.' -ForegroundColor DarkGray
Write-Host '  A ponte cai se o cabo for desconectado; rode este script de novo.' -ForegroundColor DarkGray
Write-Host ''
