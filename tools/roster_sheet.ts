/**
 * Emits the ROSTER reference sheet - one page listing every chassis, what it opens with, what it
 * is made of, and what unlocks it.
 *
 *   npx tsx tools/roster_sheet.ts [out.html]
 *
 * WHY GENERATED AND NOT WRITTEN. The page states sixteen chassis x five facts, every one of which
 * already exists in a catalog, and a hand-written copy of it is wrong the first time anything
 * moves - which in this repository is roughly weekly. Everything here is read:
 *
 *   HERO_CATALOG       name, identity line, opening weapon, bonus, unlock condition
 *   WEAPON_CATALOG     the opening weapon's display name
 *   tools/make-mechs   the COMPONENTS - class, legs, mount, torso and the three colours
 *   public/sprites     the mech's own art, inlined as a data URI
 *
 * THE COMPONENTS ARE THE INTERESTING JOIN. `HeroDef` does not know what a chassis is made of - it
 * knows a sprite key - and `make-mechs.mjs` does not know what a chassis opens with. Neither file
 * can answer "which frames carry a claw arm and what do they open with", and that is exactly the
 * question a roster sheet exists to answer, so it is joined here on the sprite key rather than
 * either file growing a copy of the other's data.
 *
 * SELF-CONTAINED, because a published artifact is served under a CSP that blocks every external
 * host. The sprites are inlined; there is no other asset.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { HERO_CATALOG } from '../src/core/data/heroes.js';
import { WEAPON_CATALOG } from '../src/core/content/weaponCatalog.js';
import { UPGRADE_CATALOG } from '../src/core/data/upgrades.js';
import { LEVEL_CATALOG } from '../src/core/content/levels.js';
import { describeUnlockDone } from '../src/core/data/unlocks.js';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-expect-error - a .mjs tool with no types, imported for its HEROES table alone.
import { HEROES as MECH_PARTS } from './make-mechs.mjs';

type Part = {
  key: string;
  cls: string;
  legs: string;
  mount: string;
  torso: string;
  hull: string;
  trim: string;
  glass: string;
};

const PARTS = new Map<string, Part>((MECH_PARTS as Part[]).map((m) => [m.key, m]));

const OUT = resolve(process.cwd(), process.argv[2] ?? 'roster.html');
const SPRITES = resolve(process.cwd(), 'public/sprites');

/** The words the game itself uses for a component, so the sheet and the identity lines agree. */
const LEGS: Record<string, string> = {
  chicken: 'Biped',
  strider: 'Strider',
  quad: 'Quad',
  hover: 'Hover',
};

const MOUNT: Record<string, string> = {
  pods: 'Twin gun pods',
  gatling: 'Rotary drums',
  cannon: 'One heavy tube',
  claws: 'Forward claw arms',
  artillery: 'Spine-slung tube',
  missiles: 'Boxed missile racks',
};

const TORSO: Record<string, string> = {
  wedge: 'Wedge',
  slab: 'Slab',
  spear: 'Spear',
  drum: 'Drum',
};

const weaponName = (id: string): string =>
  WEAPON_CATALOG.find((w) => w.id === id)?.name ?? id;

/**
 * THE THREE LOOKUPS `describeUnlockDone` TAKES, and they are three DIFFERENT catalogs.
 *
 * Getting them wrong is silent and it printed nonsense on the first run of this tool: the first
 * argument is an UPGRADE name (Plum is unlocked by a card at tier 7) and the third is a LEVEL
 * name, and passing a hero lookup and an identity function respectively produced "Finished the
 * p-shield" and "Cleared the mossy-mayhem" - sentences that are wrong in a way only a reader who
 * already knew the answer would catch.
 */
const upgradeName = (id: string): string | undefined =>
  UPGRADE_CATALOG.find((u) => u.id === id)?.name;

const levelName = (id: string): string | undefined =>
  LEVEL_CATALOG.find((l) => l.id === id)?.name;

/**
 * The unlock, as one sentence.
 *
 * `describeUnlockDone` is the game's only formatter and it is deliberately PAST TENSE - the
 * criteria are published nowhere in the game itself, and the achievement that fires on earning a
 * chassis is the single place a condition is ever stated. This sheet is the reference behind that
 * rule rather than an exception to it, so it prints the same sentence the trophy does.
 */
function unlockLine(hero: (typeof HERO_CATALOG)[number]): { text: string; kind: string } {
  if (hero.unlock.kind === 'always') return { text: 'Open from an empty save.', kind: 'open' };
  if (hero.unlock.kind === 'never') return { text: 'Criteria not written yet.', kind: 'none' };
  return {
    text: describeUnlockDone(hero.unlock, upgradeName, weaponName, levelName),
    kind: 'cond',
  };
}

/**
 * The chassis bonus, as short prose. Empty for a frame that carries none.
 *
 * GROUPED BY WEAPON, because Copper buys the Plasma Thrower two dials at once and listing them
 * separately printed its name twice in one line. A chassis bonus is one sentence about one gun.
 *
 * THE PLAYER HALF IS READ TOO. It is how Plum's shield says anything at all - the only frame whose
 * bonus touches no weapon - and leaving it out made the one chassis with no gun look like the one
 * chassis with no bonus.
 */
function bonusLine(hero: (typeof HERO_CATALOG)[number]): string {
  const out: string[] = [];

  for (const [wid, spec] of Object.entries(hero.weaponBonus ?? {})) {
    const s = spec as { mul?: Record<string, number>; add?: Record<string, number> };
    const parts: string[] = [];
    for (const [key, v] of Object.entries(s.mul ?? {})) parts.push(pct(v, key));
    for (const [key, v] of Object.entries(s.add ?? {})) {
      parts.push(`+${v} ${humanStat(key)}`);
    }
    if (parts.length > 0) out.push(`${weaponName(wid)}: ${parts.join(', ')}`);
  }

  const player = hero.player as Record<string, number> | undefined;
  const chassis = Object.entries(player ?? {}).map(([key, v]) => pct(v, key));
  // A PLAYER STAT IS A MULTIPLIER OF ONE, so 0.4 is a 60% CUT and not a 40% one. Recharge, cooldown
  // and reload all read better as "faster" than as a negative percentage of themselves.
  if (chassis.length > 0) out.push(`Chassis: ${chassis.join(', ')}`);

  return out.join(' — ');
}

/** One multiplier as a signed percentage, with the direction named where "less" means "better". */
function pct(v: number, key: string): string {
  const delta = Math.round((v - 1) * 100);
  if (LOWER_IS_BETTER.has(key)) {
    return delta < 0 ? `${-delta}% faster ${humanStat(key)}` : `${delta}% slower ${humanStat(key)}`;
  }
  return `${delta >= 0 ? '+' : ''}${delta}% ${humanStat(key)}`;
}

/** Stats a chassis bonus makes SMALLER when it is helping. */
const LOWER_IS_BETTER = new Set(['cooldown', 'reloadTime', 'shieldRecharge', 'buildTime']);

const STAT_WORDS: Record<string, string> = {
  damage: 'damage',
  range: 'range',
  cooldown: 'cooldown',
  splashRadius: 'blast radius',
  heatDispersion: 'heat dispersion',
  heatCapacity: 'heat buffer',
  projectileCount: 'projectile',
  reloadTime: 'reload',
  shieldRecharge: 'shield recharge',
  buildTime: 'drone build',
  pierce: 'pierce',
};

const humanStat = (k: string): string => STAT_WORDS[k] ?? k;

const dataUri = (key: string): string => {
  const bytes = readFileSync(resolve(SPRITES, `${key}.png`));
  return `data:image/png;base64,${bytes.toString('base64')}`;
};

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ---------------------------------------------------------------------------------------------

const cards = HERO_CATALOG.map((hero, index) => {
  const part = PARTS.get(hero.sprite);
  if (part === undefined) throw new Error(`no mech parts for sprite ${hero.sprite}`);

  const unlock = unlockLine(hero);
  const bonus = bonusLine(hero);
  const opens =
    hero.startingWeapon === null ? 'No gun at all' : weaponName(hero.startingWeapon);

  const parts = [
    ['Frame', `${part.cls === 'light' ? 'Light' : 'Heavy'} ${LEGS[part.legs] ?? part.legs}`],
    ['Mount', MOUNT[part.mount] ?? part.mount],
    ['Torso', TORSO[part.torso] ?? part.torso],
    ['Gait', hero.gait === 'walk' ? 'Walks' : 'Hovers'],
  ]
    .map(
      ([k, v]) =>
        `<div class="part"><span class="part__k">${esc(k)}</span>` +
        `<span class="part__v">${esc(v)}</span></div>`,
    )
    .join('');

  return `
  <figure class="card card--${unlock.kind}" style="--hull:${part.hull}">
    <div class="plate">
      <img src="${dataUri(hero.sprite)}" alt="${esc(hero.name)}" />
    </div>
    <figcaption>
      <div class="head">
        <span class="idx">${String(index).padStart(2, '0')}</span>
        <h2 class="name">${esc(hero.name)}</h2>
        <span class="swatch" aria-hidden="true">
          <i style="background:${part.hull}"></i><i style="background:${part.trim}"></i><i style="background:${part.glass}"></i>
        </span>
      </div>
      <div class="opens">
        <span class="k">Opens with</span>
        <span class="opens__v">${esc(opens)}</span>
      </div>
      ${bonus === '' ? '' : `<p class="bonus">${esc(bonus)}</p>`}
      <div class="parts">${parts}</div>
      <p class="cond">${esc(unlock.text)}</p>
    </figcaption>
  </figure>`;
}).join('\n');

const open = HERO_CATALOG.filter((h) => h.unlock.kind === 'always').length;
const unwritten = HERO_CATALOG.filter((h) => h.unlock.kind === 'never').length;
const earned = HERO_CATALOG.length - open - unwritten;

const html = `<title>Chassis Roster</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link
  rel="stylesheet"
  href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500&family=Saira+Condensed:wght@600;700&display=swap"
/>
<style>
  /* ---------------------------------------------------------------------------------------
     THE GAME'S OWN PALETTE, not one invented for a document about it. The dark grounds are the
     panel colours out of the front-end's Palette; the amber is the lock colour the level-up
     cards use; the blue is the UI's structural accent. A reference sheet that looked nothing
     like the thing it describes would be a worse reference for it.

     THREE THEME STATES, not two: an explicit choice stamps data-theme, and the default "system"
     setting stamps nothing at all - so the complete LIGHT palette lives on bare :root, and the
     dark one is redefined twice, once behind the media query and once behind the stamp.
     --------------------------------------------------------------------------------------- */
  :root {
    /* Cool steel rather than warm paper: this is a yard full of metal. */
    --ground: #eceff3;
    --panel: #ffffff;
    --panel-lit: #f2f5f9;
    --line: #d3d9e0;
    --line-soft: #e2e7ec;
    --ink: #161a20;
    --muted: #5f6976;
    --accent: #1f6fb2;

    --open-ink: #2c6b45;
    --lock-ink: #8a6415;

    --state: #4a5561;
    --state-bg: #e6eaef;
    --state-line: #ccd4dd;

    --display: "Saira Condensed", "Arial Narrow", Impact, sans-serif;
    --body: "IBM Plex Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    --mono: "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  }

  .card--open {
    --state: #2c6b45;
    --state-bg: #e2efe7;
    --state-line: #b3d4bf;
  }

  .card--none {
    --state: #8a6415;
    --state-bg: #faf0d9;
    --state-line: #e3cd97;
  }

  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      --ground: #11151b;
      --panel: #1a2029;
      --panel-lit: #222a35;
      --line: #2a323d;
      --line-soft: #232b35;
      --ink: #e6ebf2;
      --muted: #8a95a3;
      --accent: #5fb0f5;

      --open-ink: #6fce8f;
      --lock-ink: #f0b429;

      --state: #93a0ae;
      --state-bg: rgba(147, 160, 174, 0.12);
      --state-line: #39434f;
    }

    :root:not([data-theme="light"]) .card--open {
      --state: #6fce8f;
      --state-bg: rgba(111, 206, 143, 0.12);
      --state-line: #2f5f42;
    }

    :root:not([data-theme="light"]) .card--none {
      --state: #f0b429;
      --state-bg: rgba(240, 180, 41, 0.12);
      --state-line: #6b5217;
    }
  }

  :root[data-theme="dark"] {
    --ground: #11151b;
    --panel: #1a2029;
    --panel-lit: #222a35;
    --line: #2a323d;
    --line-soft: #232b35;
    --ink: #e6ebf2;
    --muted: #8a95a3;
    --accent: #5fb0f5;

    --open-ink: #6fce8f;
    --lock-ink: #f0b429;

    --state: #93a0ae;
    --state-bg: rgba(147, 160, 174, 0.12);
    --state-line: #39434f;
  }

  :root[data-theme="dark"] .card--open {
    --state: #6fce8f;
    --state-bg: rgba(111, 206, 143, 0.12);
    --state-line: #2f5f42;
  }

  :root[data-theme="dark"] .card--none {
    --state: #f0b429;
    --state-bg: rgba(240, 180, 41, 0.12);
    --state-line: #6b5217;
  }

  * { box-sizing: border-box; }

  body {
    margin: 0;
    /* Explicit, from a token: the viewer paints its own ground behind this page. */
    background: var(--ground);
    color: var(--ink);
    font-family: var(--body);
    font-size: 15px;
    line-height: 1.55;
    padding: 40px 24px 72px;
    -webkit-font-smoothing: antialiased;
  }

  .wrap {
    max-width: 1240px;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: 28px;
  }

  /* ---- header --------------------------------------------------------------------------- */

  header {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 24px 40px;
    flex-wrap: wrap;
    border-bottom: 2px solid var(--ink);
    padding-bottom: 14px;
  }

  h1 {
    font-family: var(--display);
    font-weight: 700;
    font-size: clamp(34px, 6vw, 52px);
    letter-spacing: 0.045em;
    text-transform: uppercase;
    line-height: 0.94;
    margin: 0;
    text-wrap: balance;
  }

  .tally {
    display: flex;
    gap: 22px;
    font-variant-numeric: tabular-nums;
  }

  .tally div { display: flex; flex-direction: column; gap: 2px; }

  .tally b {
    font-family: var(--display);
    font-weight: 700;
    font-size: 27px;
    line-height: 1;
    letter-spacing: 0.02em;
  }

  .tally span {
    font-family: var(--mono);
    text-transform: uppercase;
    letter-spacing: 0.11em;
    color: var(--muted);
    font-size: 9.5px;
  }

  .tally .t-open b { color: var(--open-ink); }
  .tally .t-none b { color: var(--lock-ink); }

  .note {
    max-width: 68ch;
    color: var(--muted);
    font-size: 14px;
    margin: 0;
  }

  .note b { color: var(--ink); font-weight: 500; }

  .note code {
    font-family: var(--mono);
    font-size: 12.5px;
    color: var(--accent);
  }

  /* ---- the grid ------------------------------------------------------------------------- */

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(272px, 1fr));
    gap: 14px;
  }

  .card {
    margin: 0;
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 4px;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  /* The chassis lit on its OWN hull colour, which is what stops sixteen grey mechs on sixteen
     identical plates reading as one photograph repeated. */
  .plate {
    background:
      radial-gradient(ellipse 70% 62% at 50% 44%,
        color-mix(in srgb, var(--hull) 22%, var(--panel-lit)) 0%,
        var(--panel-lit) 100%);
    border-bottom: 1px solid var(--line-soft);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 14px 0 6px;
  }

  .plate img {
    width: 108px;
    height: auto;
    image-rendering: pixelated;
    filter: drop-shadow(0 4px 7px rgba(0, 0, 0, 0.32));
  }

  figcaption {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 12px 13px 13px;
    flex: 1;
  }

  .head { display: flex; align-items: center; gap: 8px; }

  /* THE CATALOG INDEX, and it is information rather than ornament: hero ids are permanent once
     shipped and this array's order IS that numbering, so 00 is Slate for as long as the game
     exists. It is the select screen's order too. */
  .idx {
    font-family: var(--mono);
    font-size: 10.5px;
    font-variant-numeric: tabular-nums;
    color: var(--muted);
    padding-top: 3px;
  }

  .name {
    font-family: var(--display);
    font-weight: 700;
    font-size: 22px;
    letter-spacing: 0.035em;
    text-transform: uppercase;
    line-height: 1;
    margin: 0;
    flex: 1;
  }

  .swatch { display: inline-flex; gap: 2px; }

  .swatch i {
    width: 9px;
    height: 16px;
    border-radius: 1px;
    box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.3);
  }

  .k {
    font-family: var(--mono);
    font-size: 9.5px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--muted);
  }

  .opens {
    display: flex;
    flex-direction: column;
    gap: 1px;
    padding-bottom: 10px;
    border-bottom: 1px solid var(--line-soft);
  }

  .opens__v {
    font-family: var(--display);
    font-weight: 600;
    font-size: 18px;
    letter-spacing: 0.02em;
    line-height: 1.1;
  }

  .bonus {
    font-family: var(--mono);
    font-size: 11px;
    line-height: 1.5;
    color: var(--accent);
    margin: 0;
  }

  .parts {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 7px 12px;
  }

  .part { display: flex; flex-direction: column; min-width: 0; }

  .part__k {
    font-family: var(--mono);
    font-size: 9px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--muted);
  }

  .part__v { font-size: 13px; line-height: 1.35; }

  /* The unlock state, encoded in colour as well as in words - see the card's --state tokens. */
  .cond {
    font-family: var(--mono);
    font-size: 10.5px;
    line-height: 1.45;
    color: var(--state);
    background: var(--state-bg);
    border: 1px solid var(--state-line);
    border-radius: 3px;
    padding: 6px 8px;
    margin: auto 0 0;
  }

  /* ---- footer --------------------------------------------------------------------------- */

  footer {
    border-top: 1px solid var(--line);
    padding-top: 16px;
    color: var(--muted);
    font-size: 13.5px;
    max-width: 74ch;
  }

  footer b { color: var(--ink); font-weight: 500; }
</style>

<div class="wrap">
  <header>
    <h1>Chassis<br />Roster</h1>
    <div class="tally">
      <div class="t-open"><b>${open}</b><span>Open</span></div>
      <div><b>${earned}</b><span>Earned</span></div>
      <div class="t-none"><b>${unwritten}</b><span>Unwritten</span></div>
      <div><b>${HERO_CATALOG.length}</b><span>Total</span></div>
    </div>
  </header>

  <p class="note">
    Every frame in the game: what it opens with, what it is built from, and what it costs to earn.
    Read from <code>data/heroes.ts</code>, <code>content/weaponCatalog.ts</code> and the component
    table in <code>tools/make-mechs.mjs</code> &mdash; the last of which is the only place that
    knows a chassis has claw arms, and the first is the only place that knows what it fires.
    <b>Nothing here is retyped.</b> Regenerate with <code>npx tsx tools/roster_sheet.ts</code>.
  </p>

  <div class="grid">
${cards}
  </div>

  <footer>
    Conditions are printed in the <b>past tense</b> because that is the only way the game ever
    states one. A locked chassis in the picker is a grey silhouette and nothing else &mdash; no
    name, no identity line, no mark over the art &mdash; and the achievement that fires on earning
    it is the single surface where a criterion ever appears. This sheet is the reference behind
    that rule, not an exception to it. <b>Unwritten</b> means exactly that: the criteria have not
    been decided, and a guessed number is a design decision made by accident.
  </footer>
</div>
`;

writeFileSync(OUT, html, 'utf8');
console.log(`wrote ${OUT}  (${HERO_CATALOG.length} chassis, ${(html.length / 1024).toFixed(0)} kB)`);
