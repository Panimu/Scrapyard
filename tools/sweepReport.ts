/**
 * THE SWEEP, AS ONE PAGE. Types shared by the orchestrator and the worker, and the renderer.
 *
 * SELF-CONTAINED HTML WITH NO NETWORK AND NO BUILD STEP. It is opened off the disk by a .bat file,
 * so a stylesheet or a chart library from a CDN would make the page depend on being online to read
 * a measurement taken offline. Everything is inline, including the data.
 *
 * THE DATA IS EMBEDDED AND THE TABLES ARE BUILT IN THE BROWSER, rather than being written out as
 * 1372 rows of HTML. Sorting and filtering are the whole point of a table this size, and shipping
 * the numbers once lets the page re-sort without a regenerate.
 */
import { UPGRADE_CATALOG, WEAPON_CATALOG, type WeaponStatKey } from '../src/core/index.js';

export interface SweepPerWeapon {
  weapon: string;
  damage: number;
  share: number;
  dps: number;
  kills: number;
  elite: number;
  boss: number;
}

export interface SweepRow {
  /** `t7` holds every weapon at tier 7; `asc` promotes the ones that earned a tier 8. */
  mode: 't7' | 'asc';
  /** Which weapons actually reached tier 8 in this loadout. Empty in `t7` mode. */
  ascended: string[];
  /** `cannon+drone+...`, ids sorted - stable across catalog reordering. */
  key: string;
  /** Catalog indices, as measured. */
  combo: number[];
  seeds: number;
  wins: number;
  runs: number;
  /** Pooled across seeds. See `fold` in sweepWorker.ts for why these are sums. */
  seconds: number;
  damage: number;
  dps: number;
  taken: number;
  kills: number;
  elite: number;
  boss: number;
  bossesAlive: number;
  shield: number;
  per: SweepPerWeapon[];
}

export interface SweepMeta {
  size: number;
  seeds: number;
  playable: number;
  measured: number;
  generatedAt: string;
  weapons: { id: string; name: string }[];
  /** Fixed validated 28-loadout set rather than the exhaustive generator. See MINI_SET. */
  mini: boolean;
}

/**
 * ONE WEAPON'S NUMBERS AS AUTHORED, at tier 1 and again at tier 7.
 *
 * TIER 7 WITHOUT PASSIVES, because that is the weapon's OWN ladder. A tier on a weapon card is the
 * weapon; the passive layer is a separate thing that lifts all fourteen at once, and folding it in
 * here would mean the table said something different about a gun depending on what else the run
 * happened to be holding. The measured tables below DO include the passives - that is what they
 * are measuring - and these do not, on purpose.
 */
interface CatalogStat {
  id: string;
  name: string;
  rule: string;
  kind: string;
  damage: number;
  damage7: number;
  cooldown: number;
  cooldown7: number;
  /** damage x projectileCount / cooldown - what one gun puts out with the trigger held down. */
  burst: number;
  burst7: number;
  range: number;
  range7: number;
  /** The reach it will actually PICK a target in. Differs from range on the Cannon alone. */
  acquire7: number;
  speed: number;
  pierce7: number;
  blast7: number;
  shots7: number;
  heat: number;
  magazine7: number;
  reload7: number;
  /** "0.9x for 3s" for a gun that ignites, "" for the twelve that do not. */
  burn: string;
  puddle: string;
  /** What it becomes at tier 8 - "Chain Laser" - or "" for the nine with no ascension. */
  ascension: string;
  /** What that costs: "Targeting Optics", or "Short Missiles at 7" for the Hornet. */
  ascendNeeds: string;
}

/**
 * Sums a weapon's own ladder up to tier 7.
 *
 * ADDITIVE AND CUMULATIVE, which is the rule `resolveWeaponStats` follows: `perLevel[i]` applies at
 * tier i+2, so tier 7 is the base plus the first six rungs. Tier 8 is deliberately excluded - an
 * ascension is the one thing in this game meant to be found, and the Scrapopedia does not mention
 * it either.
 */
function atTier7(def: (typeof WEAPON_CATALOG)[number], key: WeaponStatKey): number {
  let v = def.base[key];
  for (let i = 0; i < 6 && i < def.perLevel.length; i++) {
    const d = def.perLevel[i][key];
    if (d !== undefined) v += d;
  }
  return v;
}

/**
 * WHAT A WEAPON BECOMES AT TIER 8 AND WHAT IT COSTS, in words.
 *
 * READ OFF THE UPGRADE CARD, not restated here: the ascension belongs to the card that grants the
 * weapon (data/upgrades.ts), and five of the fourteen have one. The requirement is named because
 * it is the interesting half - "Giga Laser" says nothing about why a build would go there, and
 * "needs Shaped Charges" says all of it.
 */
function ascensionOf(id: string): { name: string; needs: string } {
  const card = UPGRADE_CATALOG.find((u) => u.kind === 'weapon' && u.grantsWeapon === id);
  const asc = card?.ascension;
  if (asc === undefined) return { name: '', needs: '' };
  const req = UPGRADE_CATALOG.find((u) => u.id === asc.requires);
  const reqName = req?.name ?? asc.requires;
  return {
    name: asc.name,
    needs: asc.requiresTier > 1 ? `${reqName} at ${asc.requiresTier}` : reqName,
  };
}

function catalogStats(): CatalogStat[] {
  const RULE: Record<string, string> = {
    'highest-hp': 'strongest',
    nearest: 'nearest',
    'lowest-hp': 'weakest',
    densest: 'thickest crowd',
    'cone-densest': 'thickest, in arc',
    'cone-coldest': 'not yet burning',
    'rear-cone': 'behind you',
  };

  return WEAPON_CATALOG.map((w) => {
    const dmg = w.base.damage;
    const dmg7 = atTier7(w, 'damage');
    const cd = w.base.cooldown;
    const cd7 = atTier7(w, 'cooldown');
    const n = Math.max(1, w.base.projectileCount);
    const n7 = Math.max(1, atTier7(w, 'projectileCount'));
    const range7 = atTier7(w, 'range');
    const burn = w.burn;
    const pud = w.puddle;

    return {
      id: w.id,
      name: w.name,
      rule: RULE[w.targeting] ?? w.targeting,
      kind: w.kind === 'beam' ? 'beam' : 'projectile',
      damage: dmg,
      damage7: dmg7,
      cooldown: cd,
      cooldown7: cd7,
      // A BEAM HAS NO COOLDOWN - it fires every tick it is allowed to and heat is what stops it,
      // so `damage` on a beam is already a RATE and dividing it by anything would be wrong.
      burst: w.kind === 'beam' ? dmg : cd > 0 ? (dmg * n) / cd : 0,
      burst7: w.kind === 'beam' ? dmg7 : cd7 > 0 ? (dmg7 * n7) / cd7 : 0,
      range: w.base.range,
      range7,
      acquire7: w.acquireFrac === undefined ? range7 : range7 * w.acquireFrac,
      speed: w.base.projectileSpeed,
      pierce7: atTier7(w, 'pierce'),
      blast7: atTier7(w, 'splashRadius'),
      shots7: n7,
      heat: w.base.heatPerSec,
      magazine7: atTier7(w, 'ammoCapacity'),
      reload7: atTier7(w, 'reloadTime'),
      burn: burn === undefined ? '' : `${burn.dpsFrac}x for ${burn.seconds}s`,
      puddle: pud === undefined ? '' : `${pud.dpsFrac}x for ${pud.seconds}s`,
      ascension: ascensionOf(w.id).name,
      ascendNeeds: ascensionOf(w.id).needs,
    };
  });
}

export function renderSweepHtml(
  t7: readonly SweepRow[],
  asc: readonly SweepRow[],
  meta: SweepMeta,
): string {
  const names: Record<string, string> = {};
  for (const w of WEAPON_CATALOG) names[w.id] = w.name;

  const stats = catalogStats();

  // `</script` INSIDE THE JSON WOULD END THE BLOCK EARLY. Nothing in a weapon id can produce one
  // today, and the day somebody names a weapon after an HTML tag is not the day to find that out.
  const payload = JSON.stringify({ t7, asc, meta, names, stats }).replace(/<\//g, '<\\/');

  return `<!doctype html>
<html lang="en" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Scrapyard Loadout Sweep</title>
<style>
  :root {
    --ground: #0d1117;
    --panel: #151b24;
    --panel-2: #1b2430;
    --line: #263141;
    --ink: #dfe6ef;
    --ink-dim: #93a1b4;
    --ink-faint: #64748b;
    --accent: #e8c547;
    --good: #9ede6d;
    --bad: #e8776d;
    --mono: ui-monospace, "Cascadia Mono", "SF Mono", Menlo, Consolas, monospace;
    --sans: "Segoe UI", system-ui, -apple-system, sans-serif;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 28px 22px 80px;
    background: var(--ground);
    color: var(--ink);
    font-family: var(--sans);
    font-size: 14px;
    line-height: 1.5;
  }
  .wrap { max-width: 1240px; margin: 0 auto; }

  header { margin-bottom: 26px; }
  h1 {
    margin: 0 0 4px;
    font-size: 26px;
    font-weight: 800;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--accent);
  }
  .sub { color: var(--ink-faint); font-size: 12.5px; letter-spacing: 0.05em; }
  .sub b { color: var(--ink-dim); font-weight: 600; }

  .warn {
    margin-top: 14px;
    padding: 11px 14px;
    border: 1px solid var(--line);
    border-left: 3px solid var(--accent);
    border-radius: 6px;
    background: var(--panel);
    color: var(--ink-dim);
    font-size: 12.5px;
    max-width: 92ch;
  }

  h2 {
    margin: 34px 0 4px;
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--ink-faint);
  }
  .lede { margin: 0 0 12px; color: var(--ink-faint); font-size: 12.5px; max-width: 92ch; }

  .card {
    border: 1px solid var(--line);
    border-radius: 10px;
    background: var(--panel);
    overflow: hidden;
  }
  .scroll { overflow-x: auto; }

  table { border-collapse: collapse; width: 100%; font-variant-numeric: tabular-nums; }
  th, td { padding: 7px 12px; text-align: right; white-space: nowrap; }
  th:first-child, td:first-child { text-align: left; }
  thead th {
    position: sticky; top: 0;
    background: var(--panel-2);
    color: var(--ink-faint);
    font-size: 10.5px;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    border-bottom: 1px solid var(--line);
    cursor: pointer;
    user-select: none;
  }
  thead th:hover { color: var(--ink); }
  thead th.on { color: var(--accent); }
  thead th.on::after { content: " \\2193"; }
  thead th.on.asc::after { content: " \\2191"; }
  tbody tr { border-top: 1px solid rgba(38,49,65,0.55); }
  tbody tr:hover { background: var(--panel-2); }
  td { font-family: var(--mono); font-size: 12.5px; color: var(--ink-dim); }
  td.name { font-family: var(--sans); font-size: 13px; color: var(--ink); font-weight: 600; }
  td.guns { font-family: var(--sans); font-size: 12.5px; color: var(--ink-dim); white-space: normal; }
  .rank { color: var(--ink-faint); font-size: 11.5px; width: 44px; }
  .good { color: var(--good); }
  .bad { color: var(--bad); }
  .big { color: var(--ink); font-weight: 600; }

  .seg { display: inline-flex; border: 1px solid var(--line); border-radius: 7px; overflow: hidden; }
  .seg button {
    padding: 7px 16px;
    border: 0;
    background: var(--panel);
    color: var(--ink-dim);
    font-family: var(--sans);
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
  }
  .seg button + button { border-left: 1px solid var(--line); }
  .seg button:hover { color: var(--ink); }
  .seg button.on { background: var(--accent); color: #17202b; }
  .to { color: var(--ink-faint); padding: 0 2px; }
  .na { color: #3d4a5c; }
  .bar { display: block; height: 3px; border-radius: 2px; background: var(--accent); opacity: 0.5; margin-top: 3px; }

  .controls { display: flex; gap: 10px; align-items: center; margin: 0 0 12px; flex-wrap: wrap; }
  input[type="search"], select {
    padding: 7px 11px;
    border: 1px solid var(--line);
    border-radius: 6px;
    background: var(--panel);
    color: var(--ink);
    font-family: var(--sans);
    font-size: 13px;
  }
  input[type="search"] { min-width: 260px; }
  .count { color: var(--ink-faint); font-size: 12px; }
  footer { margin-top: 44px; color: var(--ink-faint); font-size: 11.5px; }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <h1>Loadout Sweep</h1>
    <div class="sub" id="meta"></div>
    <div class="warn">
      Every combination is held at <b>tier 7 with every passive at tier 7 and no ascension</b>, on
      the neutral Cobalt chassis, on Scrapyard. Combinations containing a mutually-exclusive pair
      are not measured &mdash; they cannot be held. Numbers are pooled across seeds rather than
      averaged, so a seed that ran longer counts for more. The reference bot plays every run, so
      this measures what the guns do for a competent-but-not-clever pilot.
      ${
        meta.mini
          ? '<br><br><b>THIS IS THE MINI SWEEP</b> \u2014 28 fixed loadouts, not the full 1500+.' +
            ' Validated to reproduce the full sweep\u2019s per-weapon share, DPS and win-rate' +
            ' RANKINGS (Spearman \u03c1 \u2265 0.95 on every metric checked against a completed' +
            ' full sweep). It does <b>not</b> have enough loadouts to say anything about pairs' +
            ' \u2014 see the note where that table would be.'
          : ''
      }
    </div>
  </header>

  <h2>The guns, as authored</h2>
  <p class="lede">
    Straight off the weapon catalog &mdash; not measured, not simulated. Where a number moves with
    the weapon&rsquo;s own tier ladder it is shown as <b>tier&nbsp;1 &rarr; tier&nbsp;7</b>; where
    it does not, it is shown once. <b>Passives are NOT included</b>: a tier on a weapon card is the
    weapon, while the passive layer lifts all fourteen at once, and folding it in would make this
    table say something different about a gun depending on what else the run held. Tier 8 is left
    out on purpose. Everything below this section is measured; this section is the input.
  </p>
  <div class="card scroll"><table id="ts"></table></div>

  <h2>Measured</h2>
  <p class="lede">
    Everything below is measured, and measured twice. <b>Tier&nbsp;7</b> is every weapon maxed by
    level-ups with no ascension &mdash; where almost every real run ends. <b>Ascended</b> promotes
    each weapon that has <i>earned</i> its tier 8 <i>in that loadout</i>, which is not the same as
    everything at eight: only five of the fourteen have an ascension at all, and the GTM Hornet
    needs the Short Missiles held alongside it, so whether a gun ascends depends on its company.
  </p>
  <div class="controls">
    <div class="seg" id="seg">
      <button type="button" data-m="t7" class="on">Tier 7</button>
      <button type="button" data-m="asc">Ascended</button>
    </div>
    <span class="count" id="mode-note"></span>
  </div>

  <h2>Weapons</h2>
  <p class="lede">
    Every weapon, across every measured loadout that contains it. <b>Share</b> is the mean fraction
    of its loadout&rsquo;s damage it took &mdash; the honest answer to &ldquo;is this gun
    carrying?&rdquo; <b>Win rate</b> is of the runs whose loadout held it. Elite and boss are that
    weapon&rsquo;s own killing blows as a share of its loadouts&rsquo; total, which is where the
    finishers separate from the chaff-clearers.
  </p>
  <div class="card scroll"><table id="tw"></table></div>

  ${
    meta.mini
      ? `<h2>Pairs</h2>
  <p class="lede">
    Not measured here. 28 loadouts touch most of the 91 possible pairs at least once, but almost
    none of them enough times to say anything about lift &mdash; the full sweep\u2019s own Pairs
    table only trusts a pair past eight observations, and a mini sweep this size clears that bar
    for barely more than a tenth of them. Run the full sweep for pair analysis; this one was
    validated for per-weapon rankings only.
  </p>`
      : `<h2>Pairs</h2>
  <p class="lede">
    Which two guns are worth more together than apart. <b>Lift</b> compares the mean damage of
    loadouts holding both against what those two weapons average separately &mdash; above 1.00 is a
    pair that helps itself, below is a pair that gets in its own way. Only pairs with enough
    loadouts behind them to mean anything are listed.
  </p>
  <div class="card scroll"><table id="tp"></table></div>`
  }

  <h2>Loadouts</h2>
  <div class="controls">
    <input type="search" id="q" placeholder="filter by weapon, e.g. drone or mortar laser">
    <select id="must"><option value="">any weapon</option></select>
    <span class="count" id="n"></span>
  </div>
  <div class="card scroll"><table id="tl"></table></div>

  <footer id="foot"></footer>
</div>
<script id="data" type="application/json">${payload}</script>
<script>
(function () {
  var D = JSON.parse(document.getElementById('data').textContent);
  var meta = D.meta, names = D.names;
  // THE TIER-7 SET IS THE DEFAULT VIEW, because that is where almost every real run ends. The
  // toggle switches every measured table below at once; the catalog table above them does not
  // move, because it is not a measurement.
  var SET = { t7: D.t7, asc: D.asc };
  var mode = D.t7.length > 0 ? 't7' : 'asc';
  var rows = SET[mode];

  // TRAILING ZEROES TRIMMED. 'd' is the MOST places to show, not exactly how many: a cooldown of
  // 0.13 and one of 1.4 both belong in the same column without the second becoming "1.400".
  // (Single quotes, not backticks: this whole script lives inside a template literal.)
  var fmt = function (v, d) {
    return v.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: d || 0 });
  };
  var pct = function (v) { return (v * 100).toFixed(1) + '%'; };

  document.getElementById('meta').innerHTML =
    '<b>' + meta.measured + '</b> of <b>' + meta.playable + '</b> playable ' + meta.size +
    '-weapon loadouts &nbsp;&middot;&nbsp; <b>' + meta.seeds + '</b> seeds each &nbsp;&middot;&nbsp; ' +
    fmt(meta.measured * meta.seeds) + ' full runs &nbsp;&middot;&nbsp; ' +
    new Date(meta.generatedAt).toLocaleString();

  // ---- a sortable table, built once and re-sorted in place -------------------------------------
  function build(el, cols, data, initial) {
    var sortKey = initial, asc = false;
    function draw() {
      var d = data.slice().sort(function (a, b) {
        var x = a[sortKey], y = b[sortKey];
        if (typeof x === 'string') return asc ? x.localeCompare(y) : y.localeCompare(x);
        return asc ? x - y : y - x;
      });
      var h = '<thead><tr><th class="rank">#</th>';
      cols.forEach(function (c) {
        h += '<th data-k="' + c.k + '" class="' + (c.k === sortKey ? 'on' + (asc ? ' asc' : '') : '') + '">' + c.t + '</th>';
      });
      h += '</tr></thead><tbody>';
      d.forEach(function (r, i) {
        h += '<tr><td class="rank">' + (i + 1) + '</td>';
        cols.forEach(function (c) { h += '<td class="' + (c.cls ? c.cls(r) : '') + '">' + c.f(r) + '</td>'; });
        h += '</tr>';
      });
      el.innerHTML = h + '</tbody>';
      el.querySelectorAll('th[data-k]').forEach(function (th) {
        th.onclick = function () {
          var k = th.getAttribute('data-k');
          if (k === sortKey) asc = !asc; else { sortKey = k; asc = false; }
          draw();
        };
      });
    }
    draw();
    return { redraw: function (next) { data = next; draw(); } };
  }

  // ---- the catalog, as authored --------------------------------------------------------------------
  // A PAIR OF NUMBERS WHERE THE LADDER MOVES ONE, and a single number where it does not. Printing
  // "240 -> 240" fourteen times for the guns whose range never changes would bury the three where
  // it does.
  function pair(a, b, d) {
    var x = fmt(a, d), y = fmt(b, d);
    return x === y ? x : x + ' <span class="to">&rarr;</span> ' + y;
  }

  build(document.getElementById('ts'), [
    { k: 'name', t: 'weapon', f: function (r) { return r.name; }, cls: function () { return 'name'; } },
    { k: 'rule', t: 'shoots the', f: function (r) { return r.rule; }, cls: function () { return 'guns'; } },
    { k: 'burst7', t: 'damage / sec', f: function (r) { return pair(r.burst, r.burst7, 1); },
      cls: function () { return 'big'; } },
    { k: 'damage7', t: 'damage', f: function (r) { return pair(r.damage, r.damage7, 2); } },
    { k: 'cooldown7', t: 'cooldown', f: function (r) {
        return r.kind === 'beam' ? '<span class="na">beam</span>' : pair(r.cooldown, r.cooldown7, 3); } },
    { k: 'shots7', t: 'shots', f: function (r) { return fmt(r.shots7); } },
    { k: 'range7', t: 'range', f: function (r) { return pair(r.range, r.range7, 1); } },
    { k: 'acquire7', t: 'picks within', f: function (r) {
        return r.acquire7 === r.range7 ? '<span class="na">all of it</span>' : fmt(r.acquire7, 1); } },
    { k: 'speed', t: 'speed', f: function (r) {
        return r.speed > 0 ? fmt(r.speed) : '<span class="na">&mdash;</span>'; } },
    { k: 'pierce7', t: 'pierce', f: function (r) {
        return r.pierce7 > 0 ? fmt(r.pierce7) : '<span class="na">&mdash;</span>'; } },
    { k: 'blast7', t: 'blast', f: function (r) {
        return r.blast7 > 0 ? fmt(r.blast7, 1) : '<span class="na">&mdash;</span>'; } },
    { k: 'heat', t: 'heat / sec', f: function (r) {
        return r.heat > 0 ? fmt(r.heat, 1) : '<span class="na">&mdash;</span>'; } },
    { k: 'magazine7', t: 'magazine', f: function (r) {
        return r.magazine7 > 0 ? fmt(r.magazine7) + ' / ' + fmt(r.reload7, 1) + 's'
                               : '<span class="na">&mdash;</span>'; } },
    { k: 'burn', t: 'sets fire', f: function (r) {
        return r.burn || r.puddle || '<span class="na">&mdash;</span>'; } },
    { k: 'ascension', t: 'tier 8', f: function (r) {
        return r.ascension || '<span class="na">none</span>'; },
      cls: function (r) { return r.ascension ? 'guns' : ''; } },
    { k: 'ascendNeeds', t: 'which needs', f: function (r) {
        return r.ascendNeeds || '<span class="na">&mdash;</span>'; },
      cls: function () { return 'guns'; } }
  ], D.stats, 'burst7');

  // ---- everything below the toggle, rebuilt when it moves ------------------------------------
  // REBUILT RATHER THAN RE-SORTED. The three tables are derived from the row set in different
  // ways - one aggregates by weapon, one by pair, one is the rows themselves - so a switch is a
  // recompute, not a filter. 1372 rows take about half a second, which is cheaper than keeping two
  // of everything in memory and remembering to update both.
  function renderMeasured() {
    rows = SET[mode];

  // ---- per weapon --------------------------------------------------------------------------------
  // WHAT THE SAME WEAPON DID IN THE OTHER SET, so the ascended view can say what the tier 8 was
  // worth rather than only what it did. Absent in the tier-7 view, where there is nothing to
  // compare against.
  var otherShare = {};
  if (mode === 'asc' && SET.t7.length > 0) {
    var oa = {};
    SET.t7.forEach(function (r) {
      r.per.forEach(function (p) {
        var q = oa[p.weapon] || (oa[p.weapon] = { n: 0, dps: 0 });
        q.n++; q.dps += p.dps;
      });
    });
    Object.keys(oa).forEach(function (k) { otherShare[k] = oa[k].n ? oa[k].dps / oa[k].n : 0; });
  }

  var agg = {};
  meta.weapons.forEach(function (w) {
    agg[w.id] = { name: w.name, id: w.id, n: 0, share: 0, dps: 0, kills: 0, elite: 0, boss: 0,
                  eliteAll: 0, bossAll: 0, wins: 0, runs: 0 };
  });
  rows.forEach(function (r) {
    r.per.forEach(function (p) {
      var a = agg[p.weapon];
      if (!a) return;
      a.n++; a.share += p.share; a.dps += p.dps; a.kills += p.kills;
      a.elite += p.elite; a.boss += p.boss;
      a.eliteAll += r.elite; a.bossAll += r.boss;
      a.wins += r.wins; a.runs += r.runs;
    });
  });
  var wrows = Object.keys(agg).map(function (id) {
    var a = agg[id];
    return {
      name: a.name, n: a.n,
      share: a.n ? a.share / a.n : 0,
      dps: a.n ? a.dps / a.n : 0,
      kills: a.n ? a.kills / a.n : 0,
      elite: a.eliteAll ? a.elite / a.eliteAll : 0,
      boss: a.bossAll ? a.boss / a.bossAll : 0,
      win: a.runs ? a.wins / a.runs : 0,
      lift: otherShare[id] > 0 && a.n ? (a.dps / a.n) / otherShare[id] : 0
    };
  }).filter(function (r) { return r.n > 0; });

  var maxShare = Math.max.apply(null, wrows.map(function (r) { return r.share; })) || 1;
  var wcols = [
    { k: 'name', t: 'weapon', f: function (r) { return r.name; }, cls: function () { return 'name'; } },
    { k: 'share', t: 'share of its loadout', f: function (r) {
        return pct(r.share) + '<span class="bar" style="width:' + (r.share / maxShare * 100).toFixed(1) + '%"></span>'; },
      cls: function () { return 'big'; } },
    { k: 'dps', t: 'dps', f: function (r) { return fmt(r.dps, 1); } },
    { k: 'kills', t: 'kills / loadout', f: function (r) { return fmt(r.kills); } },
    { k: 'elite', t: 'elite share', f: function (r) { return pct(r.elite); } },
    { k: 'boss', t: 'boss share', f: function (r) { return pct(r.boss); } },
    { k: 'win', t: 'win rate', f: function (r) { return pct(r.win); },
      cls: function (r) { return r.win >= 0.5 ? 'good' : ''; } },
    { k: 'n', t: 'loadouts', f: function (r) { return fmt(r.n); } }
  ];
  if (mode === 'asc') {
    wcols.splice(3, 0, { k: 'lift', t: 'vs tier 7', f: function (r) {
      return r.lift > 0 ? 'x' + r.lift.toFixed(2) : '<span class="na">&mdash;</span>'; },
      cls: function (r) { return r.lift >= 1.05 ? 'good' : r.lift > 0 && r.lift <= 0.97 ? 'bad' : ''; } });
  }
  build(document.getElementById('tw'), wcols, wrows, 'share');

  // ---- pairs --------------------------------------------------------------------------------------
  // SKIPPED ENTIRELY IN MINI MODE. There is no #tp table in the DOM to build into - see the
  // markup above, which replaces the whole Pairs section with an explanation instead - and
  // nothing here would be trustworthy at 28 loadouts anyway (see that same explanation).
  if (!meta.mini) {
  var solo = {}, pair = {};
  meta.weapons.forEach(function (w) { solo[w.id] = { sum: 0, n: 0 }; });
  rows.forEach(function (r) {
    var ids = r.per.map(function (p) { return p.weapon; }).sort();
    ids.forEach(function (id) { if (solo[id]) { solo[id].sum += r.damage; solo[id].n++; } });
    for (var i = 0; i < ids.length; i++) {
      for (var j = i + 1; j < ids.length; j++) {
        var k = ids[i] + '|' + ids[j];
        if (!pair[k]) pair[k] = { a: ids[i], b: ids[j], sum: 0, n: 0, wins: 0, runs: 0 };
        pair[k].sum += r.damage; pair[k].n++; pair[k].wins += r.wins; pair[k].runs += r.runs;
      }
    }
  });
  var prows = Object.keys(pair).map(function (k) {
    var p = pair[k];
    var both = p.sum / p.n;
    var ea = solo[p.a].n ? solo[p.a].sum / solo[p.a].n : 0;
    var eb = solo[p.b].n ? solo[p.b].sum / solo[p.b].n : 0;
    var expect = (ea + eb) / 2;
    return {
      name: names[p.a] + ' + ' + names[p.b],
      both: both, expect: expect,
      lift: expect > 0 ? both / expect : 0,
      win: p.runs ? p.wins / p.runs : 0,
      n: p.n
    };
  }).filter(function (r) { return r.n >= 8; });

  build(document.getElementById('tp'), [
    { k: 'name', t: 'pair', f: function (r) { return r.name; }, cls: function () { return 'name'; } },
    { k: 'lift', t: 'lift', f: function (r) { return r.lift.toFixed(3); },
      cls: function (r) { return 'big ' + (r.lift >= 1.03 ? 'good' : r.lift <= 0.97 ? 'bad' : ''); } },
    { k: 'both', t: 'damage together', f: function (r) { return fmt(r.both); } },
    { k: 'expect', t: 'expected apart', f: function (r) { return fmt(r.expect); } },
    { k: 'win', t: 'win rate', f: function (r) { return pct(r.win); },
      cls: function (r) { return r.win >= 0.5 ? 'good' : ''; } },
    { k: 'n', t: 'loadouts', f: function (r) { return fmt(r.n); } }
  ], prows, 'lift');
  }

  // ---- loadouts -----------------------------------------------------------------------------------
  var lrows = rows.map(function (r) {
    var top = r.per.slice().sort(function (a, b) { return b.damage - a.damage; })[0];
    var asc = r.ascended || [];
    return {
      nasc: asc.length,
      ascNames: asc.map(function (i) { return names[i]; }).join(', '),
      guns: r.per.map(function (p) { return names[p.weapon]; }).join(', '),
      search: r.per.map(function (p) { return p.weapon + ' ' + names[p.weapon]; }).join(' ').toLowerCase(),
      damage: r.damage, dps: r.dps, kills: r.kills, elite: r.elite, boss: r.boss,
      taken: r.taken, win: r.runs ? r.wins / r.runs : 0,
      carry: top ? names[top.weapon] + ' ' + pct(top.share) : ''
    };
  });

  var cols = [
    { k: 'guns', t: 'loadout', f: function (r) { return r.guns; }, cls: function () { return 'guns'; } },
    { k: 'dps', t: 'dps', f: function (r) { return fmt(r.dps, 1); }, cls: function () { return 'big'; } },
    { k: 'damage', t: 'damage', f: function (r) { return fmt(r.damage); } },
    { k: 'kills', t: 'kills', f: function (r) { return fmt(r.kills); } },
    { k: 'elite', t: 'elite', f: function (r) { return fmt(r.elite); } },
    { k: 'boss', t: 'boss', f: function (r) { return fmt(r.boss); } },
    { k: 'taken', t: 'taken', f: function (r) { return fmt(r.taken); } },
    { k: 'win', t: 'wins', f: function (r) { return pct(r.win); },
      cls: function (r) { return r.win >= 0.5 ? 'good' : ''; } },
    { k: 'carry', t: 'top gun', f: function (r) { return r.carry; } }
  ];
  // WHICH GUNS REACHED TIER 8 IN THIS ROW, in the ascended view only - there is nothing to say in
  // the other one. It is the column that explains the rest of the row: two loadouts differing by
  // one weapon can differ by two ascensions, because the Hornet's requirement is a weapon.
  if (mode === 'asc') {
    cols.splice(1, 0, { k: 'nasc', t: 'tier 8', f: function (r) {
      return r.nasc > 0 ? r.nasc + ' <span class="na">' + r.ascNames + '</span>'
                        : '<span class="na">none</span>'; },
      cls: function () { return 'guns'; } });
  }

  var tl = build(document.getElementById('tl'), cols, lrows, 'dps');
  var sel = document.getElementById('must');
  // POPULATED ONCE. This runs on every toggle, and appending fourteen more options each time is
  // exactly the kind of bug a rebuild invites.
  if (sel.options.length <= 1) {
    meta.weapons.forEach(function (w) {
      var o = document.createElement('option');
      o.value = w.id; o.textContent = w.name;
      sel.appendChild(o);
    });
  }

  function filter() {
    var q = document.getElementById('q').value.trim().toLowerCase();
    var must = sel.value;
    var terms = q === '' ? [] : q.split(/\\s+/);
    var out = lrows.filter(function (r) {
      if (must !== '' && r.search.indexOf(must) < 0) return false;
      return terms.every(function (t) { return r.search.indexOf(t) >= 0; });
    });
    document.getElementById('n').textContent = out.length + ' of ' + lrows.length;
    tl.redraw(out);
  }
  document.getElementById('q').oninput = filter;
  sel.onchange = filter;
  filter();
  }

  var seg = document.getElementById('seg');
  [].forEach.call(seg.querySelectorAll('button'), function (b) {
    b.onclick = function () {
      var m = b.getAttribute('data-m');
      if (SET[m].length === 0) return;
      mode = m;
      [].forEach.call(seg.querySelectorAll('button'), function (x) {
        x.className = x.getAttribute('data-m') === mode ? 'on' : '';
      });
      renderMeasured();
      note();
    };
    if (SET[b.getAttribute('data-m')].length === 0) {
      b.disabled = true;
      b.style.opacity = '0.4';
      b.style.cursor = 'not-allowed';
    }
  });
  [].forEach.call(seg.querySelectorAll('button'), function (x) {
    x.className = x.getAttribute('data-m') === mode ? 'on' : '';
  });

  function note() {
    var n = document.getElementById('mode-note');
    if (mode !== 'asc') { n.textContent = SET.t7.length + ' loadouts, no weapon above tier 7'; return; }
    var withAny = SET.asc.filter(function (r) { return r.ascended && r.ascended.length > 0; }).length;
    n.textContent = SET.asc.length + ' loadouts, ' + withAny + ' of them able to ascend something';
  }
  note();
  renderMeasured();

  document.getElementById('foot').textContent =
    'Generated by tools/sweepLoadout.ts. Re-run with sweep.bat --fresh after any balance change: ' +
    'these numbers are only true of the catalog they were measured against.';
})();
</script>
</body>
</html>
`;
}
