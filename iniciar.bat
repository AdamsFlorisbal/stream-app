@echo off
rem O servidor escreve em UTF-8 (acentos, tracos longos, blocos do banner). Sem
rem trocar a pagina de codigo, o console decodifica esses bytes como cp1252 e
rem as palavras acentuadas saem embaralhadas.
rem
rem Esta linha precisa vir ANTES de qualquer outra coisa: o cmd.exe acompanha
rem sua posicao no arquivo por offset de bytes, e trocar a pagina de codigo no
rem meio do script dessincroniza o parser -- o sintoma e' a expansao retardada
rem parar de funcionar e "!VAR!" ser impresso literalmente.
rem
rem Pelo mesmo motivo, TODO este arquivo precisa ser ASCII puro: um unico byte
rem acentuado desloca a contagem e o cmd passa a ler no meio de uma palavra.
chcp 65001 >nul 2>nul

rem ===========================================================================
rem  DECK CONTROL - inicia tudo de uma vez
rem
rem  1. verifica o Node.js e instala as dependencias na primeira execucao
rem  2. sobe o LibreHardwareMonitor (temperaturas de CPU/GPU)
rem  3. abre o OBS Studio, se voce quiser
rem  4. inicia o servidor, que por sua vez cuida sozinho da ponte USB (adb)
rem
rem  ATENCAO: este arquivo e' lido como ANSI pelo Windows. Mantenha-o sem
rem  acentos, ou o texto aparece corrompido no terminal.
rem ===========================================================================

setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"
title Deck Control

rem --- Ajustes: troque 0 por 1 para ligar -----------------------------------
set "START_SENSORS=1"
set "START_OBS=0"
set "OPEN_BROWSER=0"
rem --------------------------------------------------------------------------

set "TASK_SENSORS=DeckControl-Sensores"
set "LHM_EXE=%~dp0server\data\tools\LibreHardwareMonitor\LibreHardwareMonitor.exe"
set "PORT=8787"

rem O nome da variavel %ProgramFiles(x86)% contem parenteses, que fecham um
rem bloco "if (...)" antes da hora. Copiar para um nome simples aqui fora
rem evita o erro de sintaxe la' embaixo.
set "PF64=%ProgramFiles%"
set "PF86=%ProgramFiles(x86)%"

echo.
echo   ##  DECK CONTROL
echo   --------------------------------------------------
echo.

rem === 1. Node.js ============================================================

where node >nul 2>nul
if errorlevel 1 (
  echo   [X] Node.js nao encontrado.
  echo       Instale a versao LTS em https://nodejs.org e rode este arquivo de novo.
  echo.
  pause
  exit /b 1
)
for /f "tokens=*" %%v in ('node -v') do set "NODEV=%%v"
echo   [ok] Node.js !NODEV!

if not exist "server\node_modules" (
  echo   [..] Primeira execucao: instalando dependencias...
  pushd server
  call npm install --no-audit --no-fund
  set "NPMFAIL=!errorlevel!"
  popd
  if not "!NPMFAIL!"=="0" (
    echo   [X] Falha ao instalar as dependencias.
    echo.
    pause
    exit /b 1
  )
  echo   [ok] Dependencias instaladas
) else (
  echo   [ok] Dependencias presentes
)

rem === 2. Sensores de temperatura ===========================================

if "%START_SENSORS%"=="1" (
  tasklist /FI "IMAGENAME eq LibreHardwareMonitor.exe" 2>nul | find /I "LibreHardwareMonitor.exe" >nul
  if errorlevel 1 (
    schtasks /Query /TN "%TASK_SENSORS%" >nul 2>nul
    if errorlevel 1 (
      echo   [--] Sensores nao instalados - sem temperatura de CPU/GPU.
      echo        Para ligar:  powershell -ExecutionPolicy Bypass -File tools\instalar-sensores.ps1
    ) else (
      rem A tarefa foi registrada com privilegio elevado, entao nao ha UAC aqui.
      schtasks /Run /TN "%TASK_SENSORS%" >nul 2>nul
      if errorlevel 1 (
        echo   [!] Nao consegui iniciar a tarefa "%TASK_SENSORS%".
      ) else (
        echo   [ok] Sensores iniciados ^(LibreHardwareMonitor^)
      )
    )
  ) else (
    echo   [ok] Sensores ja em execucao
  )
) else (
  echo   [--] Sensores desligados neste arquivo ^(START_SENSORS=0^)
)

rem === 3. OBS Studio =========================================================

if "%START_OBS%"=="1" (
  tasklist /FI "IMAGENAME eq obs64.exe" 2>nul | find /I "obs64.exe" >nul
  if errorlevel 1 (
    set "OBSDIR="
    if exist "%PF64%\obs-studio\bin\64bit\obs64.exe" set "OBSDIR=%PF64%\obs-studio\bin\64bit"
    if exist "%PF86%\obs-studio\bin\64bit\obs64.exe" set "OBSDIR=%PF86%\obs-studio\bin\64bit"
    if defined OBSDIR (
      rem O OBS exige que o diretorio de trabalho seja o proprio bin\64bit.
      start "" /D "!OBSDIR!" "!OBSDIR!\obs64.exe" --disable-shutdown-check
      echo   [ok] OBS Studio iniciado
    ) else (
      echo   [!] OBS Studio nao encontrado nos caminhos padrao.
    )
  ) else (
    echo   [ok] OBS Studio ja em execucao
  )
) else (
  echo   [--] OBS nao sera aberto ^(START_OBS=0^)
)

rem === 4. Navegador local (opcional) ========================================

if "%OPEN_BROWSER%"=="1" (
  start "" "http://127.0.0.1:%PORT%"
  echo   [ok] Navegador aberto
)

rem === 5. Servidor ==========================================================

echo.
echo   --------------------------------------------------
echo   Iniciando o servidor. Feche esta janela para parar.
echo.

cd /d "%~dp0server"
node src/main.js

echo.
echo   O servidor foi encerrado.
echo.
pause
