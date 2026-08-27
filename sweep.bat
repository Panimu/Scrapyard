@echo off
setlocal

rem ==============================================================================================
rem  Measure EVERY loadout a player could build, and open the results.
rem
rem    sweep                    the lot - every playable 5-weapon loadout, 3 seeds each,
rem                             measured TWICE: at tier 7, and again with ascensions allowed
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

rem The page is only opened when it exists, so a run that measured nothing does not pop up a
rem browser at a missing file.
if exist "sweep\index.html" (
  echo   Opening sweep\index.html
  start "" "sweep\index.html"
)

endlocal
