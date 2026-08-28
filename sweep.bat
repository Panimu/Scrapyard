@echo off
setlocal

rem ==============================================================================================
rem  Measure EVERY loadout a player could build, and open the results.
rem
rem    sweep                    the lot - every playable 5-weapon loadout, 3 seeds each,
rem                             measured TWICE: at tier 7, and again with ascensions allowed
rem    minisweep                the same 28 loadouts, always re-measured - see minisweep.bat,
rem                             which is what you want while iterating on a balance change
rem    sweep --mini             28 FIXED loadouts instead - minutes, not hours. Validated to
rem                             reproduce the full sweep's per-weapon rankings; says nothing
rem                             about pairs (too few loadouts touch any one pair enough times).
rem                             Writes sweep/mini.html, never overwrites the full sweep's page.
rem    sweep --fresh            discard previous results first. USE THIS AFTER A BALANCE CHANGE.
rem    sweep --ascend none      tier 7 only - half the work, half the page
rem    sweep --size 3           every 3-weapon loadout instead
rem    sweep --seeds 5          five seeds a loadout rather than three
rem    sweep --jobs 4           fewer workers, to leave the machine usable
rem    sweep --priority normal  run flat out. The default is BELOW normal, so the desktop stays
rem                             usable while it works - it costs almost nothing in wall clock.
rem    sweep --limit 20         stop after 20 loadouts - for checking the plumbing
rem
rem  IT RESUMES. Results are appended as each loadout finishes, so closing this window costs only
rem  whatever was in flight. Run it again and it picks up. The two tiers are kept in separate
rem  files, so an ascended sweep never overwrites the tier-7 results.
rem
rem  RUN IT WITH --fresh AFTER CHANGING ANY NUMBER IN THE WEAPON CATALOG. A resumed sweep mixes
rem  results measured before and after the change and says nothing about either.
rem ==============================================================================================

cd /d "%~dp0"

echo.
echo   Scrapyard loadout sweep
echo.

call npx tsx tools/sweepLoadout.ts %*
if errorlevel 1 (
  echo.
  echo   The sweep failed - see the error above. Nothing was opened.
  exit /b 1
)

rem WHICH PAGE, decided by whether this was a mini run. The mini sweep writes mini.html and the
rem full one writes index.html; this used to open index.html unconditionally, so `sweep --mini`
rem finished its work and then opened the FULL sweep's page - whatever numbers happened to be
rem sitting there from whenever that was last run, presented as though they were this run's
rem results. There is no louder failure than that: the page renders perfectly and is simply about
rem a different set of measurements.
set "PAGE=index.html"
rem The trailing space on BOTH sides makes this an exact flag match rather than a substring
rem one - without it a future `--minimum` would be read as `--mini` and open the wrong page.
echo.%* | findstr /I /C:"--mini " >nul
if not errorlevel 1 set "PAGE=mini.html"

rem The page is only opened when it exists, so a run that measured nothing does not pop up a
rem browser at a missing file.
if exist "sweep\%PAGE%" (
  echo   Opening sweep\%PAGE%
  start "" "sweep\%PAGE%"
)

endlocal
