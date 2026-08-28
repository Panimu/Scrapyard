@echo off
setlocal

rem ==============================================================================================
rem  Re-measure the game against the 28-loadout mini set, and open the results.
rem
rem    minisweep                the lot: 28 fixed loadouts, 5 seeds each, at tier 7 AND ascended.
rem                             Minutes, not hours. Writes sweep\mini.html.
rem    minisweep --ascend none  the tier-7 half alone, in half the time
rem    minisweep --jobs 4       fewer workers, to leave the machine usable
rem
rem  Anything else is passed straight through to the sweep - see sweep.bat for the full set.
rem
rem  IT ALWAYS RE-MEASURES, which is the whole difference between this and `sweep --mini`.
rem  A mini sweep exists to answer "did the change I just made move anything", and a resumed one
rem  silently mixes results from before and after that change - which is the one way this tool can
rem  give a confident wrong answer. Minutes is cheap enough that discarding is the right default.
rem  If you genuinely want to resume an interrupted mini sweep, `sweep --mini` does that.
rem
rem  It is SAFE to run beside a full sweep's results: the mini set writes its own
rem  results-mini-*.jsonl files and its own page, so --fresh here never discards the full sweep's
rem  work. See resultsPath/pagePath in tools/sweepLoadout.ts, which key both on the mini flag.
rem
rem  THE FULL SWEEP IS NOT THIS. `sweep` measures all 1372 playable loadouts and takes about
rem  ninety minutes; it is user-initiated only. This is the cheap check that stands in for it while
rem  iterating, and it reproduces the full sweep's PER-WEAPON rankings but says nothing about which
rem  pairs work together - too few loadouts touch any one pair for that.
rem ==============================================================================================

cd /d "%~dp0"

echo.
echo   Scrapyard mini sweep - 28 loadouts, re-measured from scratch
echo.

call npx tsx tools/sweepLoadout.ts --mini --fresh %*
if errorlevel 1 (
  echo.
  echo   The sweep failed - see the error above. Nothing was opened.
  exit /b 1
)

rem Opened only when it exists, so a run that measured nothing does not pop up a browser at a
rem missing file. NOTE THE FILENAME: the mini sweep writes mini.html, and opening index.html here
rem would show the FULL sweep's page - stale numbers from whenever that was last run, presented as
rem though they were the results of this one. sweep.bat had exactly that bug.
if exist "sweep\mini.html" (
  echo   Opening sweep\mini.html
  start "" "sweep\mini.html"
)

endlocal
