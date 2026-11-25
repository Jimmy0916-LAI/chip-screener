@echo off
chcp 65001 >nul
setlocal
set "LAUNCHER=%~dp0scripts\launcher.py"

where py >nul 2>nul
if %ERRORLEVEL%==0 (
  py -B -X utf8 "%LAUNCHER%" %*
  goto :done
)

where python >nul 2>nul
if %ERRORLEVEL%==0 (
  python -B -X utf8 "%LAUNCHER%" %*
  goto :done
)

echo [ERROR] Python 3.10+ not found. Please install Python first.
pause
exit /b 1

:done
if not %ERRORLEVEL%==0 (
  echo.
  echo Launcher exited with error code %ERRORLEVEL%.
  pause
)
exit /b %ERRORLEVEL%