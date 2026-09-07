<#
.SYNOPSIS
    Faz o Deck Control iniciar junto com o Windows.

.DESCRIPTION
    Cria uma tarefa agendada que sobe o servidor no logon do usuario atual,
    em janela oculta. Nao exige privilegios de administrador porque a tarefa
    roda no seu proprio contexto.

.PARAMETER Remove
    Remove a tarefa em vez de cria-la.
#>

[CmdletBinding()]
param([switch]$Remove)

$ErrorActionPreference = 'Stop'
$TaskName = 'DeckControl'

if ($Remove) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
    Write-Host "  Inicializacao automatica removida." -ForegroundColor Yellow
    exit 0
}

$serverDir = Resolve-Path (Join-Path $PSScriptRoot '..\server')
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { throw 'Node.js nao encontrado no PATH.' }

$action = New-ScheduledTaskAction -Execute $node -Argument 'src\main.js' -WorkingDirectory $serverDir
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings `
    -Description 'Servidor Deck Control (atalhos, OBS e telemetria).' -Force | Out-Null

Write-Host ""
Write-Host "  Pronto. O Deck Control sobe sozinho no proximo logon." -ForegroundColor Green
Write-Host "  Para iniciar agora:  Start-ScheduledTask -TaskName $TaskName" -ForegroundColor DarkGray
Write-Host "  Para desfazer:       .\instalar-servico.ps1 -Remove" -ForegroundColor DarkGray
Write-Host ""
