@echo off
setlocal EnableDelayedExpansion
title Aestheticy - Automated Windows Installer Builder

echo ============================================================================
echo   Aestheticy - Automated Windows Installer Builder (Aestheticy Setup.exe)
echo   App ID: com.aestheticy.app
echo ============================================================================
echo.

:: Ensure we are running from the project root directory
cd /d "%~dp0"

:: 1. Verify Node.js and npm are installed
where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Node.js was not found on your PATH.
    echo Please install Node.js 20 LTS or newer from https://nodejs.org/ and try again.
    pause
    exit /b 1
)

for /f "tokens=*" %%i in ('node -v') do set NODE_VER=%%i
echo [1/5] Detected Node.js %NODE_VER%

:: 2. Install base project dependencies if tsx or vite is missing
if not exist "node_modules\.bin\tsx.cmd" (
    echo [2/5] Installing project dependencies via npm install...
    call npm install --legacy-peer-deps
    if !ERRORLEVEL! NEQ 0 (
        echo [ERROR] Failed to install project dependencies.
        pause
        exit /b 1
    )
) else (
    echo [2/5] Project dependencies verified in node_modules.
)

:: 3. electron, electron-builder and electron-updater are regular package.json dependencies now,
::    so step 2 already installed them. Just double-check the packager is there.
if not exist "node_modules\.bin\electron-builder.cmd" (
    echo [3/5] Packager missing - running npm install again...
    call npm install --legacy-peer-deps
    if !ERRORLEVEL! NEQ 0 (
        echo [ERROR] Failed to install Electron packaging tools.
        pause
        exit /b 1
    )
) else (
    echo [3/5] Electron packaging tools ready.
)

:: 4. Build Vite frontend bundle and compile Electron main & preload scripts
echo [4/5] Building React frontend ^(dist/^) and Electron main/preload bundle ^(dist-electron/^)...
call npm run build
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Frontend Vite build failed.
    pause
    exit /b 1
)

call npm run build:electron
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Electron TypeScript compilation failed.
    pause
    exit /b 1
)

:: 5. Package Windows NSIS Installer (.exe) via electron-builder
echo [5/5] Packaging Windows x64 NSIS Installer ^("release\Aestheticy Setup.exe"^)...
call npx electron-builder --win --x64
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] electron-builder failed to package the Windows installer.
    pause
    exit /b 1
)

echo.
echo ============================================================================
echo   BUILD COMPLETE!
echo   Installer created at: "%~dp0release\Aestheticy Setup.exe"
echo ============================================================================
echo.

if exist "release\" (
    explorer "release"
)

pause
