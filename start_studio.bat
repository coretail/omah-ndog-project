@echo off
setlocal
chcp 65001 >nul

set "ROOT_DIR=%~dp0"
pushd "%ROOT_DIR%" || exit /b 1

set "PYTHON_CMD=python"
if exist "%ROOT_DIR%venv\Scripts\python.exe" set "PYTHON_CMD=%ROOT_DIR%venv\Scripts\python.exe"

set "STUDIO_PORT=8000"
if not "%1"=="" set "STUDIO_PORT=%1"

echo ============================================================
echo   OMAH NDOG - SELF-PHOTO STUDIO LAUNCHER
echo ============================================================
echo.

if not exist "%ROOT_DIR%frontend\dist\index.html" (
    echo [INFO] Build frontend belum ditemukan. Mencoba menjalankan npm run build...
    if exist "%ROOT_DIR%frontend\package.json" (
        pushd "%ROOT_DIR%frontend"
        call npm run build
        if errorlevel 1 (
            echo [WARN] Gagal build frontend. Pastikan Node.js terinstal dan jalankan npm run build di frontend\.
        )
        popd
    )
)

echo [1/2] Menyalakan FastAPI Studio Server di port %STUDIO_PORT%...
start "Omah Ndog Studio Server" "%PYTHON_CMD%" -m uvicorn backend.main:create_app --factory --host 0.0.0.0 --port %STUDIO_PORT%

echo [2/2] Menunggu server siap lalu membuka Kiosk di browser...
timeout /t 3 /nobreak >nul
start "" "http://localhost:%STUDIO_PORT%"

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
