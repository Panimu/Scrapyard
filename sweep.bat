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
rem    sweep --resume           RESUME an interrupted run instead of re-measuring. See below.
rem    sweep --ascend none      tier 7 only - half the work, half the page
rem    sweep --size 3           every 3-weapon loadout instead
rem    sweep --seeds 5          five seeds a loadout rather than three
rem    sweep --jobs 4           fewer workers, to leave the machine usable
rem    sweep --priority normal  run flat out. The default is BELOW normal, so the desktop stays
rem                             usable while it works - it costs almost nothing in wall clock.
rem    sweep --limit 20         stop after 20 loadouts - for checking the plumbing
rem
rem  IT RE-MEASURES BY DEFAULT. `--fresh` is added for you unless you pass `--resume`, because a
rem  resumed sweep APPENDS to whatever results are already on disk - so the page ends up describing
rem  a mixture of the catalogue before and after the change the run was started to measure, and it
rem  renders perfectly while doing so. That is the worst way for a report to be wrong, and it is the
rem  normal outcome of forgetting a flag, so the flag is now the other way round.
rem
rem  --resume EXISTS FOR ONE CASE: an interrupted run of a catalogue that has not changed since.
rem  Results are appended as each loadout finishes, so closing the window costs only whatever was in
rem  flight. If anything at all has been edited in between - a weapon number, an exclusion, the event
rem  table, or `src/sim/botPolicy.ts`, since the bot drives every run - do not use it.
rem
rem  NOTE WHAT --fresh DOES NOT CLEAR. The results file is keyed on size, seed count and tier, so a
rem  fresh 3-seed run leaves 5-seed files untouched and a later 5-seed run can still resume from
rem  them. Check `sweep\` for leftovers from other configurations before trusting a number.
rem ==============================================================================================

cd /d "%~dp0"

echo.
echo   Scrapyard loadout sweep
echo.

rem FRESH BY DEFAULT. `--resume` is this launcher's own flag - sweepLoadout.ts does not know it, so
rem it is stripped rather than forwarded. The trailing space on both sides of the findstr match makes
rem it an exact flag test, so a future `--resumes` cannot be mistaken for it.
set "ARGS=%*"
echo.%* | findstr /I /C:"--resume " >nul
if errorlevel 1 (
  set "ARGS=%* --fresh"
) else (
  set "ARGS=%ARGS:--resume=%"
)

call npx tsx tools/sweepLoadout.ts %ARGS%
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
