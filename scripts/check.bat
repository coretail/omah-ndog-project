@echo off
setlocal

set "ROOT_DIR=%~dp0.."
pushd "%ROOT_DIR%" || exit /b 1

set "RUFF_CMD=ruff"
if exist "%ROOT_DIR%\venv\Scripts\ruff.exe" set "RUFF_CMD=%ROOT_DIR%\venv\Scripts\ruff.exe"

set "PYTEST_CMD=pytest"
if exist "%ROOT_DIR%\venv\Scripts\pytest.exe" set "PYTEST_CMD=%ROOT_DIR%\venv\Scripts\pytest.exe"

echo [1/4] Running ruff check backend...
"%RUFF_CMD%" check backend
if errorlevel 1 (
    popd
    exit /b 1
)

echo [2/4] Running pytest -q...
"%PYTEST_CMD%" -q
if errorlevel 1 (
    popd
    exit /b 1
)

if exist "%ROOT_DIR%\frontend\package.json" (
    pushd "%ROOT_DIR%\frontend" || (
        popd
        exit /b 1
    )
    echo [3/4] Running npx tsc --noEmit...
    call npx tsc --noEmit
    if errorlevel 1 (
        popd
        popd
        exit /b 1
    )
    echo [4/4] Running npm run build...
    call npm run build
    if errorlevel 1 (
        popd
        popd
        exit /b 1
    )
    popd
) else (
    echo [SKIP] frontend belum diinisialisasi (Fase 2^)
)

popd
exit /b 0
