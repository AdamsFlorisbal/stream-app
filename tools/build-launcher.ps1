# ============================================================================
#  Deck Control - compila o launcher ("Deck Control.exe")
#
#  Gera um executavel nativo pequeno que so' abre tools\tray.ps1 escondido --
#  o mesmo que iniciar-bandeja.vbs faz, mas como um .exe de verdade (icone
#  proprio, nome no Explorer, sem depender do wscript). Usa o compilador C#
#  que ja vem com o Windows (.NET Framework) e o proprio System.Drawing para
#  desenhar o icone -- nada e' baixado da internet.
#
#  Rode de novo sempre que mover tools\launcher ou quiser trocar o icone:
#    powershell -NoProfile -ExecutionPolicy Bypass -File tools\build-launcher.ps1
# ============================================================================

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$RepoRoot    = Resolve-Path (Join-Path $PSScriptRoot '..')
$LauncherDir = Join-Path $PSScriptRoot 'launcher'
$IcoPath     = Join-Path $LauncherDir 'deck-control.ico'
$CsPath      = Join-Path $LauncherDir 'Launcher.cs'
$OutExe      = Join-Path $RepoRoot 'Deck Control.exe'

New-Item -ItemType Directory -Force -Path $LauncherDir | Out-Null

# --- 1. Icone ----------------------------------------------------------
# Mesmo desenho da bandeja (grade de 4 cores sobre fundo escuro), em varias
# resolucoes reais -- nao um unico bitmap esticado -- para ficar nitido tanto
# no icone pequeno da bandeja quanto no icone grande do Explorer.

function New-RoundedRectPath {
  param([single]$X, [single]$Y, [single]$W, [single]$H, [single]$Radius)
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = $Radius * 2
  $path.AddArc($X, $Y, $d, $d, 180, 90)
  $path.AddArc($X + $W - $d, $Y, $d, $d, 270, 90)
  $path.AddArc($X + $W - $d, $Y + $H - $d, $d, $d, 0, 90)
  $path.AddArc($X, $Y + $H - $d, $d, $d, 90, 90)
  $path.CloseFigure()
  return $path
}

function New-AppIconBitmap {
  param([int]$Size)

  $bmp = New-Object System.Drawing.Bitmap $Size, $Size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.Clear([System.Drawing.Color]::Transparent)

  $radius = $Size * 0.22
  $bgPath = New-RoundedRectPath 0 0 $Size $Size $radius
  $bgBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    (New-Object System.Drawing.PointF(0, 0)), (New-Object System.Drawing.PointF($Size, $Size)),
    [System.Drawing.Color]::FromArgb(255, 17, 24, 39), [System.Drawing.Color]::FromArgb(255, 3, 5, 9))
  $g.FillPath($bgBrush, $bgPath)
  $bgBrush.Dispose()
  $bgPath.Dispose()

  $palette = @(
    [System.Drawing.Color]::FromArgb(255, 34, 211, 238),
    [System.Drawing.Color]::FromArgb(255, 167, 139, 250),
    [System.Drawing.Color]::FromArgb(255, 244, 114, 182),
    [System.Drawing.Color]::FromArgb(255, 52, 211, 153)
  )
  $cell = $Size * 0.28
  $gap = $Size * 0.045
  $ox = $Size * 0.18
  $oy = $Size * 0.16
  $coords = @(@(0, 0), @(1, 0), @(0, 1), @(1, 1))
  for ($i = 0; $i -lt 4; $i++) {
    $x = $ox + $coords[$i][0] * ($cell + $gap)
    $y = $oy + $coords[$i][1] * ($cell + $gap)
    $cellPath = New-RoundedRectPath $x $y $cell $cell ($cell * 0.22)
    $b = New-Object System.Drawing.SolidBrush $palette[$i]
    $g.FillPath($b, $cellPath)
    $b.Dispose()
    $cellPath.Dispose()
  }

  $g.Dispose()
  return $bmp
}

function New-IcoFile {
  param([int[]]$Sizes, [string]$OutPath)

  $images = @()
  foreach ($size in $Sizes) {
    $bmp = New-AppIconBitmap -Size $size
    $ms = New-Object System.IO.MemoryStream
    $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    $images += , @{ Size = $size; Bytes = $ms.ToArray() }
    $bmp.Dispose()
    $ms.Dispose()
  }

  $buffer = New-Object System.IO.MemoryStream
  $bw = New-Object System.IO.BinaryWriter $buffer
  $bw.Write([UInt16]0)
  $bw.Write([UInt16]1)
  $bw.Write([UInt16]$images.Count)

  $offset = 6 + (16 * $images.Count)
  foreach ($img in $images) {
    $sizeByte = if ($img.Size -ge 256) { 0 } else { $img.Size }
    $bw.Write([byte]$sizeByte)
    $bw.Write([byte]$sizeByte)
    $bw.Write([byte]0)
    $bw.Write([byte]0)
    $bw.Write([UInt16]1)
    $bw.Write([UInt16]32)
    $bw.Write([UInt32]$img.Bytes.Length)
    $bw.Write([UInt32]$offset)
    $offset += $img.Bytes.Length
  }
  foreach ($img in $images) { $bw.Write($img.Bytes) }

  $bw.Flush()
  [System.IO.File]::WriteAllBytes($OutPath, $buffer.ToArray())
  $bw.Dispose()
  $buffer.Dispose()
}

Write-Host '  Desenhando icone...' -ForegroundColor Cyan
New-IcoFile -Sizes @(16, 32, 48, 256) -OutPath $IcoPath
Write-Host "  Icone salvo em $IcoPath" -ForegroundColor Green

# --- 2. Compilar ---------------------------------------------------------

$runtimeDir = [System.Runtime.InteropServices.RuntimeEnvironment]::GetRuntimeDirectory()
$csc = Join-Path $runtimeDir 'csc.exe'
if (-not (Test-Path $csc)) { throw "csc.exe nao encontrado em $runtimeDir (.NET Framework precisa estar instalado)." }

Write-Host '  Compilando...' -ForegroundColor Cyan
& $csc /nologo /target:winexe /platform:anycpu /out:"$OutExe" /win32icon:"$IcoPath" /r:System.Windows.Forms.dll "$CsPath"
if ($LASTEXITCODE -ne 0) { throw 'csc.exe falhou ao compilar o launcher.' }

Write-Host ''
Write-Host "  Pronto: $OutExe" -ForegroundColor Green
Write-Host '  De dois cliques nele para abrir o Deck Control na bandeja.' -ForegroundColor DarkGray
Write-Host ''
