@echo off
setlocal enabledelayedexpansion

REM =========================================================
REM Miniconda/conda 仮想環境 env1 で http.server を起動
REM =========================================================

set "CONDA_ENV_NAME=env1"
set "PORT=8000"

REM このbatがあるフォルダへ移動（= viewer/ を想定）
cd /d "%~dp0"

REM ---- conda.exe の場所を特定 ----
if defined CONDA_EXE (
  set "CONDA_CMD=%CONDA_EXE%"
) else (
  where conda >nul 2>&1
  if not errorlevel 1 (
    set "CONDA_CMD=conda"
  ) else (
    set "CAND1=%USERPROFILE%\miniconda3\Scripts\conda.exe"
    set "CAND2=%USERPROFILE%\Miniconda3\Scripts\conda.exe"
    set "CAND3=%USERPROFILE%\anaconda3\Scripts\conda.exe"
    if exist "!CAND1!" (set "CONDA_CMD=!CAND1!") else (
      if exist "!CAND2!" (set "CONDA_CMD=!CAND2!") else (
        if exist "!CAND3!" (set "CONDA_CMD=!CAND3!") else (
          echo [ERROR] conda.exe が見つかりません。
          echo - conda init を実行してPATHに通すか、
          echo - start.bat 内で conda.exe のフルパスを指定してください。
          pause
          exit /b 1
        )
      )
    )
  )
)

REM ---- env1 が存在するか確認 ----
"%CONDA_CMD%" env list | findstr /I /C:"%CONDA_ENV_NAME%" >nul 2>&1
if errorlevel 1 (
  echo [ERROR] conda環境 "%CONDA_ENV_NAME%" が見つかりません。
  echo conda env list で環境名を確認してください。
  pause
  exit /b 1
)

REM ---- ブラウザを開く ----
start "" "http://localhost:%PORT%/"

REM ---- env1 で http.server 起動（activate不要）----
"%CONDA_CMD%" run -n "%CONDA_ENV_NAME%" python -m http.server %PORT%

endlocal
