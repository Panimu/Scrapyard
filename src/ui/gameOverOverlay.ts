/**
 * The run summary, for both endings.
 *
 * Shows what the run actually was - time, level, kills by archetype, damage in and out,
 * accuracy, the upgrades taken - and the SEED as a 6-character code. Seed plus the input log is
 * a full replay, so the code is the one value worth being able to read off a phone screen and
 * type into `npm run sim` (DESIGN.md §11).
 *
 * Reads `world.stats`, `world.levelUp.stacks` and the catalogs. Writes nothing.
 */

import {
  RANKS,
  HERO_CATALOG,
  RUN_PHASE_VICTORY,
  type World,
} from '../core/index.js';
import { seedToCode } from '../appState.js';
import { formatClock } from './hud.js';

export interface GameOverCallbacks {
  /** Same hero, new seed. */
  readonly onRetry: () => void;
  /** Back to the mech picker. */
  readonly onChangeMech: () => void;
}

export class GameOverOverlay {
  readonly element: HTMLDivElement;

  private readonly title: HTMLDivElement;
  private readonly eyebrow: HTMLDivElement;
  private readonly body: HTMLDivElement;

  constructor(cb: GameOverCallbacks) {
    const el = document.createElement('div');
    el.className = 'overlay summary';
    el.hidden = true;
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-label', 'Run summary');

    const head = document.createElement('div');
    head.className = 'summary__head';
    head.innerHTML = `<div class="eyebrow" data-eyebrow>Run over</div>
      <h2 class="summary__title" data-title>SCRAPPED</h2>`;
    el.appendChild(head);

    const body = document.createElement('div');
    body.className = 'summary__body';
    el.appendChild(body);

    const actions = document.createElement('div');
    actions.className = 'summary__actions';
    const again = button('Run it again', 'btn btn--primary', cb.onRetry);
    const change = button('Change mech', 'btn', cb.onChangeMech);
    actions.append(again, change);
    el.appendChild(actions);

    this.element = el;
    this.title = head.querySelector('[data-title]') as HTMLDivElement;
    this.eyebrow = head.querySelector('[data-eyebrow]') as HTMLDivElement;
    this.body = body;
  }

  get visible(): boolean {
    return !this.element.hidden;
  }

  hide(): void {
    this.element.hidden = true;
  }

  /** Built once per run end, not per frame - this is the only place it allocates DOM. */
  show(world: World, seed: number): void {
    const won = world.phase === RUN_PHASE_VICTORY;
    this.eyebrow.textContent = won ? 'Scraplord down' : 'Run over';
    this.title.textContent = won ? 'SURVIVED' : 'SCRAPPED';
    this.title.classList.toggle('summary__title--win', won);

    const s = world.stats;
    const hero = HERO_CATALOG[world.player.heroId];
    const accuracy = s.shotsFired > 0 ? Math.round((s.shotsHit / s.shotsFired) * 100) : 0;

    const upgrades: string[] = [];
    for (let i = 0; i < world.upgradeCatalog.length; i++) {
      const n = world.levelUp.stacks[i] ?? 0;
      if (n > 0) upgrades.push(`${world.upgradeCatalog[i].name}|x${n}`);
    }

    // BY RANK, not by chassis: under the cycle ladder every enemy in a cycle shares one body
    // class, so a swarmer/grunt/bruiser split says nothing the clock did not already say.
    const byArchetype: string[] = [];
    for (let r = 0; r < s.killsByRank.length; r++) {
      const n = s.killsByRank[r];
      if (n > 0) byArchetype.push(`${RANKS[r]?.name ?? `rank ${r}`}|${n}`);
    }

    // WHERE THE DAMAGE ACTUALLY CAME FROM, biggest first.
    //
    // A run ends with five guns and a total, and the total says nothing about which of the five
    // was carrying it - which is exactly the question a player asks after a run that went badly.
    // Sorted descending and shown as a share of the total, because the ranking and the proportion
    // are the two readings; the raw number is the least useful of the three and still the one a
    // bare list would lead with.
    //
    // Only sources that actually dealt damage appear. A weapon held for thirty seconds and
    // dropped, or a shield on a build that never took the backlash, would otherwise pad the list
    // with zeroes and push the answer off a phone screen.
    const bySource: string[] = [];
    const total = s.damageDealt > 0 ? s.damageDealt : 1;
    const sources: { name: string; amount: number }[] = [];
    for (let i = 0; i < s.damageByWeapon.length; i++) {
      const amount = s.damageByWeapon[i];
      if (amount > 0) sources.push({ name: world.weaponCatalog[i]?.name ?? `weapon ${i}`, amount });
    }
    if (s.damageByShield > 0) sources.push({ name: 'Energy Shield', amount: s.damageByShield });
    sources.sort((a, b) => b.amount - a.amount);
    for (const src of sources) {
      bySource.push(`${src.name}|${compact(src.amount)}  ${Math.round((src.amount / total) * 100)}%`);
    }

    this.body.innerHTML = `
      <div class="grid">
        ${stat('Survived', formatClock(world.runSec))}
        ${stat('Level', String(world.player.level))}
        ${stat('Kills', String(s.kills))}
        ${stat('Peak horde', String(s.peakEnemies))}
        ${stat('Damage dealt', compact(s.damageDealt))}
        ${stat('Damage taken', compact(s.damageTaken))}
        ${stat('Accuracy', `${accuracy}%`)}
        ${stat('Gems', String(s.gemsCollected))}
        ${s.damagePrevented > 0 ? stat('Shielded', compact(s.damagePrevented)) : ''}
      </div>
      <div class="list">
        <div class="eyebrow">Damage by source</div>
        ${bySource.length > 0 ? bySource.map(row).join('') : '<div class="list__row">none dealt</div>'}
      </div>
      <div class="list">
        <div class="eyebrow">Kills by type</div>
        ${byArchetype.length > 0 ? byArchetype.map(row).join('') : '<div class="list__row">none</div>'}
      </div>
      <div class="list">
        <div class="eyebrow">Upgrades</div>
        ${upgrades.length > 0 ? upgrades.map(row).join('') : '<div class="list__row">none taken</div>'}
      </div>
      <div class="list">
        <div class="list__row"><span>Mech</span><span>${escapeHtml(hero?.name ?? '-')}</span></div>
        <div class="list__row"><span>Ticks</span><span>${world.stats.endTick || world.tick}</span></div>
      </div>
      <div class="summary__seed" aria-label="Run seed">${seedToCode(seed)}</div>
      <div class="eyebrow" style="text-align:center">Seed - replay it with npm run sim</div>
    `;

    this.element.hidden = false;
  }
}

function stat(k: string, v: string): string {
  return `<div class="stat"><div class="stat__k">${escapeHtml(k)}</div><div class="stat__v">${escapeHtml(v)}</div></div>`;
}

function row(pair: string): string {
  const [k, v] = pair.split('|');
  return `<div class="list__row"><span>${escapeHtml(k)}</span><span>${escapeHtml(v)}</span></div>`;
}

function compact(n: number): string {
  const v = Math.round(n);
  return v >= 10000 ? `${(v / 1000).toFixed(1)}k` : String(v);
}

/**
 * Catalog names and descriptions are authored in this repo, not user input - but this overlay is
 * the only place that builds HTML from strings, so it escapes anyway rather than leaving a
 * template that would be unsafe the moment someone interpolates a run name into it.
 */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function button(text: string, className: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = className;
  b.textContent = text;
  b.addEventListener('click', onClick);
  return b;
}
