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
import { WEAPON_CATALOG } from '../src/core/index.js';

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
}

export function renderSweepHtml(rows: readonly SweepRow[], meta: SweepMeta): string {
  const names: Record<string, string> = {};
  for (const w of WEAPON_CATALOG) names[w.id] = w.name;

  // `</script` INSIDE THE JSON WOULD END THE BLOCK EARLY. Nothing in a weapon id can produce one
  // today, and the day somebody names a weapon after an HTML tag is not the day to find that out.
  const payload = JSON.stringify({ rows, meta, names }).replace(/<\//g, '<\\/');

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
    </div>
  </header>

  <h2>Weapons</h2>
  <p class="lede">
    Every weapon, across every measured loadout that contains it. <b>Share</b> is the mean fraction
    of its loadout&rsquo;s damage it took &mdash; the honest answer to &ldquo;is this gun
    carrying?&rdquo; <b>Win rate</b> is of the runs whose loadout held it. Elite and boss are that
    weapon&rsquo;s own killing blows as a share of its loadouts&rsquo; total, which is where the
    finishers separate from the chaff-clearers.
  </p>
  <div class="card scroll"><table id="tw"></table></div>

  <h2>Pairs</h2>
  <p class="lede">
    Which two guns are worth more together than apart. <b>Lift</b> compares the mean damage of
    loadouts holding both against what those two weapons average separately &mdash; above 1.00 is a
    pair that helps itself, below is a pair that gets in its own way. Only pairs with enough
    loadouts behind them to mean anything are listed.
  </p>
  <div class="card scroll"><table id="tp"></table></div>

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
  var rows = D.rows, meta = D.meta, names = D.names;

  var fmt = function (v, d) { return v.toLocaleString('en-US', { minimumFractionDigits: d||0, maximumFractionDigits: d||0 }); };
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

  // ---- per weapon --------------------------------------------------------------------------------
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
      win: a.runs ? a.wins / a.runs : 0
    };
  }).filter(function (r) { return r.n > 0; });

  var maxShare = Math.max.apply(null, wrows.map(function (r) { return r.share; })) || 1;
  build(document.getElementById('tw'), [
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
  ], wrows, 'share');

  // ---- pairs --------------------------------------------------------------------------------------
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

  // ---- loadouts -----------------------------------------------------------------------------------
  var lrows = rows.map(function (r) {
    var top = r.per.slice().sort(function (a, b) { return b.damage - a.damage; })[0];
    return {
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

  var tl = build(document.getElementById('tl'), cols, lrows, 'dps');
  var sel = document.getElementById('must');
  meta.weapons.forEach(function (w) {
    var o = document.createElement('option');
    o.value = w.id; o.textContent = w.name;
    sel.appendChild(o);
  });

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

  document.getElementById('foot').textContent =
    'Generated by tools/sweepLoadout.ts. Re-run with sweep.bat --fresh after any balance change: ' +
    'these numbers are only true of the catalog they were measured against.';
})();
</script>
</body>
</html>
`;
}
