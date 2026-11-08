@echo off
setlocal EnableDelayedExpansion
title Aestheticy - Development Mode Launcher

echo ============================================================================
echo   Aestheticy - Hybrid Local Server + Desktop UI Launcher
echo ============================================================================
echo.

cd /d "%~dp0"

where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Node.js was not found on your PATH.
    echo Please install Node.js 20 LTS or newer from https://nodejs.org/ and try again.
    pause
    exit /b 1
)

if not exist "node_modules\.bin\tsx.cmd" (
    echo [1/2] Installing project dependencies...
    call npm install --legacy-peer-deps
    if !ERRORLEVEL! NEQ 0 (
        echo.
        echo [ERROR] npm install failed. Please check your internet connection and try again.
        pause
        exit /b 1
    )
) else (
    echo [1/2] Dependencies verified.
)

echo [2/2] Starting Aestheticy on http://localhost:3000 ...
start "" "http://localhost:3000"
call npm run dev
pause
