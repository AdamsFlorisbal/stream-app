@echo off
rem ===========================================================
rem  Deck Control - inicia o servidor
rem  Instala as dependencias na primeira execucao.
rem ===========================================================
setlocal
cd /d "%~dp0server"
title Deck Control

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js nao encontrado.
  echo   Instale a versao LTS em https://nodejs.org e rode este arquivo de novo.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo.
  echo   Primeira execucao: instalando dependencias...
  echo.
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo.
    echo   Falha ao instalar as dependencias.
    pause
    exit /b 1
  )
)

node src/main.js
echo.
echo   O servidor foi encerrado.
pause
