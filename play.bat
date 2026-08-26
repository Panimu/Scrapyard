@echo off
setlocal

REM ============================================================================================
REM  play.bat - rebuild the desktop game and run it.
REM
REM      play              build Debug and launch
REM      play release      build Release and launch
REM      play build        build only, do not launch
REM
REM  WHY THIS KILLS THE GAME FIRST. A running Scrapyard.exe holds Scrapyard.Core.dll and
REM  Scrapyard.Meta.dll open, and MSBuild's copy step then fails with MSB3021 after ten retries -
REM  which looks like a compile error and is not one. Closing the window by hand first works and
REM  is exactly the sort of thing nobody should have to remember, so this does it. Nothing is
REM  lost: a run is not saved between launches, and progress is banked to the save file once a
REM  second while you play.
REM
REM  WHY IT DOES NOT LAUNCH A STALE BINARY. If the build fails, this stops and says so rather
REM  than starting whatever exe happened to be sitting in bin - which would look like the change
REM  simply did nothing.
REM
REM  THE WORKING DIRECTORY DOES NOT MATTER. Sprites.FindRoot walks UP from the exe's own folder
REM  looking for public\sprites, so the game finds its art wherever it is started from.
REM
REM  For the WEB build instead, run `npm run dev` and open the printed URL.
REM ============================================================================================

set "CONFIG=Debug"
set "LAUNCH=1"

if /i "%~1"=="release" set "CONFIG=Release"
if /i "%~1"=="build"   set "LAUNCH=0"

set "PROJ=%~dp0cs\src\Scrapyard.Game"
set "EXE=%PROJ%\bin\%CONFIG%\net8.0\Scrapyard.exe"

REM Silent, and a failure here is fine - it just means nothing was running.
taskkill /IM Scrapyard.exe /F >nul 2>&1
if not errorlevel 1 echo [play] closed the running game.

echo [play] building %CONFIG%...
dotnet build "%PROJ%" -c %CONFIG% -v m --nologo
if errorlevel 1 goto :failed

if "%LAUNCH%"=="0" (
    echo [play] built. Not launching ^(you asked for "build"^).
    goto :eof
)

if not exist "%EXE%" (
    echo.
    echo [play] BUILD SUCCEEDED BUT %EXE% IS MISSING.
    echo [play] That usually means the project moved - check the PROJ path in this file.
    echo.
    pause
    exit /b 1
)

echo [play] launching...
start "Scrapyard" "%EXE%"
goto :eof

:failed
echo.
echo [play] BUILD FAILED - the game was NOT launched, so what you would have run is the old one.
echo [play] Scroll up for the first error; the ones after it are usually consequences.
echo.
pause
exit /b 1
