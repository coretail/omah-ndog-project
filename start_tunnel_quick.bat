@echo off
setlocal
chcp 65001 >nul

set "STUDIO_PORT=8000"
if not "%~1"=="" set "STUDIO_PORT=%~1"

echo %STUDIO_PORT%| findstr /r "^[0-9][0-9]*$" >nul
if errorlevel 1 (
    echo [ERROR] Port tidak valid: "%STUDIO_PORT%". Gunakan angka 1..65535.
    pause
    exit /b 1
)
if %STUDIO_PORT% LSS 1 (
    echo [ERROR] Port harus antara 1 dan 65535.
    pause
    exit /b 1
)
if %STUDIO_PORT% GTR 65535 (
    echo [ERROR] Port harus antara 1 dan 65535.
    pause
    exit /b 1
)

echo ============================================================
echo   OMAH NDOG - CLOUDFLARE QUICK TUNNEL (TESTING)
echo ============================================================
echo.

set "CLOUDFLARED_CMD="
call :find_cloudflared
if defined CLOUDFLARED_CMD goto :run_tunnel

echo [INFO] cloudflared belum ditemukan. Mencoba menginstal via winget...
where winget >nul 2>&1
if errorlevel 1 (
    echo [ERROR] winget tidak tersedia. Instal cloudflared secara manual terlebih dahulu.
    pause
    exit /b 1
)

winget install --id Cloudflare.cloudflared -e --accept-package-agreements --accept-source-agreements
if errorlevel 1 (
    echo [ERROR] Gagal menginstal cloudflared lewat winget.
    pause
    exit /b 1
)

call :find_cloudflared
if not defined CLOUDFLARED_CMD (
    echo [WARN] cloudflared sudah terpasang, tetapi PATH terminal belum diperbarui.
    echo        Tutup jendela ini lalu jalankan ulang start_tunnel_quick.bat.
    pause
    exit /b 0
)

:run_tunnel
echo [INFO] Menyalakan Cloudflare Quick Tunnel ke http://localhost:%STUDIO_PORT%...
echo.
echo ------------------------------------------------------------
echo   CARA PAKAI UNTUK TESTING HP:
echo   1. Tunggu link https://....trycloudflare.com muncul di bawah.
echo   2. Salin link tersebut ke Admin Dashboard ^(/admin^) -^> Public Base URL.
echo   3. Klik Simpan, lalu buat sesi baru di Kiosk dan scan QR dari HP.
echo   4. Biarkan jendela ini tetap terbuka selama pengujian berlangsung.
echo ------------------------------------------------------------
echo.
"%CLOUDFLARED_CMD%" tunnel --url "http://localhost:%STUDIO_PORT%"
echo.
echo [INFO] Tunnel dihentikan.
pause
exit /b 0

:find_cloudflared
where cloudflared >nul 2>&1
if not errorlevel 1 (
    set "CLOUDFLARED_CMD=cloudflared"
    exit /b 0
)
if exist "%ProgramFiles(x86)%\cloudflared\cloudflared.exe" (
    set "CLOUDFLARED_CMD=%ProgramFiles(x86)%\cloudflared\cloudflared.exe"
    exit /b 0
)
if exist "%ProgramFiles%\cloudflared\cloudflared.exe" (
    set "CLOUDFLARED_CMD=%ProgramFiles%\cloudflared\cloudflared.exe"
    exit /b 0
)
if exist "%LocalAppData%\Microsoft\WinGet\Links\cloudflared.exe" (
    set "CLOUDFLARED_CMD=%LocalAppData%\Microsoft\WinGet\Links\cloudflared.exe"
    exit /b 0
)
exit /b 1
