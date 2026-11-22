@echo off
setlocal
chcp 65001 >nul

set "ROOT_DIR=%~dp0"
pushd "%ROOT_DIR%" || exit /b 1

set "PYTHON_CMD=python"
if exist "%ROOT_DIR%venv\Scripts\python.exe" set "PYTHON_CMD=%ROOT_DIR%venv\Scripts\python.exe"

set "STUDIO_PORT=8000"
if not "%~1"=="" set "STUDIO_PORT=%~1"

echo %STUDIO_PORT%| findstr /r "^[0-9][0-9]*$" >nul
if errorlevel 1 (
    echo [ERROR] Port tidak valid: "%STUDIO_PORT%". Gunakan angka 1..65535.
    popd
    exit /b 1
)
if %STUDIO_PORT% LSS 1 (
    echo [ERROR] Port harus antara 1 dan 65535.
    popd
    exit /b 1
)
if %STUDIO_PORT% GTR 65535 (
    echo [ERROR] Port harus antara 1 dan 65535.
    popd
    exit /b 1
)

echo ============================================================
echo   OMAH NDOG - SELF-PHOTO STUDIO LAUNCHER
echo ============================================================
echo.

if not exist "%ROOT_DIR%frontend\dist\index.html" (
    echo [INFO] Build frontend belum ditemukan. Mempersiapkan frontend...
    if exist "%ROOT_DIR%frontend\package.json" (
        pushd "%ROOT_DIR%frontend"
        if not exist "%ROOT_DIR%frontend\node_modules" (
            if exist "%ROOT_DIR%frontend\package-lock.json" (
                echo [INFO] Menginstal dependency frontend dengan npm ci...
                call npm ci
            ) else (
                echo [INFO] Menginstal dependency frontend dengan npm install...
                call npm install
            )
            if errorlevel 1 (
                echo [WARN] Gagal menginstal dependency frontend.
            )
        )
        echo [INFO] Menjalankan npm run build...
        call npm run build
        if errorlevel 1 (
            echo [WARN] Gagal build frontend. Pastikan Node.js terinstal dan jalankan npm run build di frontend\.
        )
        popd
    )
)

echo [1/2] Menyalakan FastAPI Studio Server di port %STUDIO_PORT%...
start "Omah Ndog Studio Server" "%PYTHON_CMD%" -m uvicorn backend.main:create_app --factory --host 0.0.0.0 --port %STUDIO_PORT%

echo [2/2] Menunggu kesiapan server (/api/health)...
set "SERVER_READY=0"
for /l %%i in (1,1,15) do (
    powershell -NoProfile -Command "try { $r = Invoke-WebRequest -Uri 'http://127.0.0.1:%STUDIO_PORT%/api/health' -UseBasicParsing -TimeoutSec 2; if ($r.StatusCode -eq 200) { exit 0 } else { exit 1 } } catch { exit 1 }" >nul 2>&1
    if not errorlevel 1 (
        set "SERVER_READY=1"
        goto :server_ready
    )
    timeout /t 1 /nobreak >nul
)

:server_ready
if "%SERVER_READY%"=="1" (
    echo [OK] Server siap. Membuka Kiosk di browser...
    start "" "http://localhost:%STUDIO_PORT%"
) else (
    echo [WARN] Server belum merespons /api/health setelah 15 detik. Cek jendela "Omah Ndog Studio Server" lalu buka http://localhost:%STUDIO_PORT% secara manual.
)

echo.
echo ------------------------------------------------------------
echo   PANDUAN OPERATOR STUDIO
echo ------------------------------------------------------------
echo - Kiosk Lokal : http://localhost:%STUDIO_PORT%
echo - Admin       : http://localhost:%STUDIO_PORT%/admin
echo - Akses HP LAN: Pastikan port %STUDIO_PORT% TCP diizinkan di Windows Firewall.
echo - Tunnel      : Gunakan Cloudflare Named Tunnel agar domain tetap:
echo                 cloudflared tunnel run ^<nama-tunnel^>
echo                 (Quick Tunnel membuat URL berubah setiap restart).
echo ------------------------------------------------------------
echo.
popd
exit /b 0
