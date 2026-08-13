/**
 * The in-run HUD: hull integrity, XP, level, clock, kills, laser heat - plus the debug panel.
 *
 * DOM, not Pixi text. Text in the scene graph would break the sprite batch and cost a texture
 * bind per label; the DOM composites on its own layer, gets the system font for free, and reads
 * correctly to VoiceOver. It also means the HUD lays out with `env(safe-area-inset-*)` instead
 * of us re-deriving the notch in world space.
 *
 * THE DEBUG PANEL IS NOT OPTIONAL POLISH. Safari Web Inspector needs a Mac, and this project
 * does not have one, so an in-game readout is the only on-device profiler this game will ever
 * get (DESIGN.md §10.5). Tap the clock to toggle it.
 *
 * Every write is guarded by a cached previous value: `textContent =` on an unchanged string
 * still invalidates layout, and this runs 60 times a second.
 */

import { HEAT_MAX, HEAT_RESUME, MAX_WEAPONS, RUN_PHASE_INTRO, type World } from '../core/index.js';

/**
 * HEAT READOUT - one chip per beam weapon held.
 *
 * The lasers are a DUTY CYCLE, so the bar is the weapon: a player who cannot see heat cannot play
 * them. Three things have to read at a glance, mid-horde, without thinking:
 *
 *   1. WHICH LASER. The fill is the weapon's own `beamColour`, so the bar on the HUD and the line
 *      on the battlefield are obviously the same gun. No labels are needed to make that link -
 *      the name under the bar is for learning it the first time.
 *   2. THE 50 LINE. Heat is HYSTERETIC: at 100 the weapon cuts out and does not come back until
 *      it has cooled to HEAT_RESUME. A bar that only showed "how full" would say a weapon at 99
 *      and a weapon at 51 are nearly the same, when one is about to die for two seconds and the
 *      other is about to be fine. The notch at 50 is the whole mechanic made visible, and the
 *      tinted band above it is the region where cutting out is a real cost.
 *   3. OFFLINE, AND FOR HOW LONG. Overheating is a hard cut, not a fade, so it gets a hard visual
 *      state - and a countdown, because "it will come back" is useless without "in 2.4 s".
 *
 * Projectile weapons (the Cannon) get no chip: `heat` is 0 forever and a permanently empty bar is
 * noise that teaches the player to ignore the whole row.
 */


export interface DebugInfo {
  /** Rolling mean frame time, ms. */
  frameMs: number;
  /** Worst frame in the last second, ms - the number that actually reads as a stutter. */
  worstMs: number;
  /** Sim steps taken on the last frame. >1 means we are catching up. */
  steps: number;
  enemies: number;
  projectiles: number;
  pickups: number;
  effects: number;
  sprites: number;
  /** Events overwritten before the renderer read them. Should stay at 0. */
  droppedEvents: number;
}

export interface HudCallbacks {
  readonly onPause: () => void;
  readonly onToggleDebug: () => void;
}

export class Hud {
  readonly element: HTMLDivElement;

  private readonly hpFill: HTMLDivElement;
  private readonly hpLabel: HTMLDivElement;
  private readonly xpFill: HTMLDivElement;
  private readonly level: HTMLDivElement;
  private readonly timer: HTMLDivElement;
  private readonly kills: HTMLDivElement;
  private readonly hurt: HTMLDivElement;
  private readonly debug: HTMLPreElement;

  /** Heat chips: built once at MAX_WEAPONS, shown/hidden as beam weapons are acquired. */
  private readonly heatRow: HTMLDivElement;
  private readonly heatChips: HTMLDivElement[] = [];
  private readonly heatFills: HTMLDivElement[] = [];
  private readonly heatNames: HTMLSpanElement[] = [];
  private readonly heatStatus: HTMLSpanElement[] = [];
  /** Catalog index currently bound to each chip, or -1. Rebinding is what rewrites name/colour. */
  private readonly heatDefId = new Int32Array(MAX_WEAPONS).fill(-1);
  /** Last written fill percent, overheated flag and countdown tenths. -1 forces the first write. */
  private readonly heatPct = new Int32Array(MAX_WEAPONS).fill(-1);
  private readonly heatOut = new Int32Array(MAX_WEAPONS).fill(-1);
  private readonly heatTenths = new Int32Array(MAX_WEAPONS).fill(-1);
  private heatShown = -1;

  private lastHpText = '';
  private lastLevelText = '';
  private lastTimerText = '';
  private lastKillsText = '';
  private lastDebugText = '';
  private hurtTimer = 0;

  constructor(cb: HudCallbacks) {
    const el = document.createElement('div');
    el.className = 'hud';
    el.innerHTML = `
      <div class="hud__top">
        <div class="hud__bars">
          <div class="bar">
            <div class="bar__fill bar__fill--hp" data-hp></div>
            <div class="bar__label" data-hp-label>0 / 0</div>
          </div>
          <div class="bar bar--xp"><div class="bar__fill bar__fill--xp" data-xp></div></div>
        </div>
        <div class="hud__level" data-level aria-label="Level">1</div>
      </div>
      <div class="hud__heat" data-heat></div>
      <div class="hud__stats">
        <div class="hud__timer" data-timer role="button" tabindex="0"
             aria-label="Elapsed time. Activate to toggle the debug readout.">0:00</div>
        <div class="hud__kills" data-kills>0 kills</div>
      </div>
      <pre class="hud__debug" data-debug hidden></pre>
      <div class="hud__hurt" data-hurt aria-hidden="true"></div>
    `;

    const pause = document.createElement('button');
    pause.className = 'btn hud__pause';
    pause.type = 'button';
    pause.textContent = 'II';
    pause.setAttribute('aria-label', 'Pause');
    pause.addEventListener('click', cb.onPause);
    el.appendChild(pause);

    this.element = el;
    this.hpFill = query(el, '[data-hp]');
    this.hpLabel = query(el, '[data-hp-label]');
    this.xpFill = query(el, '[data-xp]');
    this.level = query(el, '[data-level]');
    this.timer = query(el, '[data-timer]');
    this.kills = query(el, '[data-kills]');
    this.hurt = query(el, '[data-hurt]');
    this.debug = query<HTMLPreElement>(el, '[data-debug]');

    // Chips are built ONCE, at the slot cap, and then only shown/hidden and rewritten. Creating
    // DOM at the moment a laser is picked would put a layout+style recalc inside the level-up
    // transition, which is exactly when a dropped frame is most visible.
    const heatRow = query(el, '[data-heat]');
    heatRow.hidden = true;
    this.heatRow = heatRow;
    for (let i = 0; i < MAX_WEAPONS; i++) {
      const chip = document.createElement('div');
      chip.className = 'heat';
      chip.hidden = true;
      chip.innerHTML = `
        <div class="heat__track"><div class="heat__fill" data-fill></div></div>
        <div class="heat__foot"><span class="heat__name" data-name></span><span
          class="heat__status" data-status></span></div>`;
      heatRow.appendChild(chip);
      this.heatChips.push(chip);
      this.heatFills.push(query(chip, '[data-fill]'));
      this.heatNames.push(query<HTMLSpanElement>(chip, '[data-name]'));
      this.heatStatus.push(query<HTMLSpanElement>(chip, '[data-status]'));
    }

    this.timer.addEventListener('click', cb.onToggleDebug);
  }

  setVisible(visible: boolean): void {
    this.element.hidden = !visible;
  }

  setDebugVisible(visible: boolean): void {
    this.debug.hidden = !visible;
  }

  /** Fired from EV_PLAYER_DAMAGED. Cosmetic only. */
  flashHurt(): void {
    this.hurtTimer = 0.22;
    this.hurt.classList.add('hud__hurt--on');
  }

  /**
   * @param dtSec real seconds since the last call, for the damage vignette's own fade
   * @param debug when present, the debug panel is rewritten; pass undefined to leave it alone
   */
  update(world: World, dtSec: number, debug?: DebugInfo): void {
    if (this.hurtTimer > 0) {
      this.hurtTimer -= dtSec;
      if (this.hurtTimer <= 0) this.hurt.classList.remove('hud__hurt--on');
    }

    const p = world.player;
    const maxHp = p.stats.maxHp > 0 ? p.stats.maxHp : 1;
    const hpFrac = clamp01(p.hp / maxHp);
    this.hpFill.style.transform = `scaleX(${hpFrac})`;

    const hpText = `${Math.max(0, Math.ceil(p.hp))} / ${Math.round(maxHp)}`;
    if (hpText !== this.lastHpText) {
      this.lastHpText = hpText;
      this.hpLabel.textContent = hpText;
    }

    const xpNeed = p.xpToNext > 0 ? p.xpToNext : 1;
    this.xpFill.style.transform = `scaleX(${clamp01(p.xp / xpNeed)})`;

    const levelText = String(p.level);
    if (levelText !== this.lastLevelText) {
      this.lastLevelText = levelText;
      this.level.textContent = levelText;
    }

    // `runSec` is the clock the design says to show: it is 0 through the 3 s intro and frozen
    // while a level-up card is open, so it measures time SURVIVED rather than time elapsed.
    const timerText =
      world.phase === RUN_PHASE_INTRO ? 'READY' : formatClock(world.runSec);
    if (timerText !== this.lastTimerText) {
      this.lastTimerText = timerText;
      this.timer.textContent = timerText;
    }

    const killsText = `${world.stats.kills} kills`;
    if (killsText !== this.lastKillsText) {
      this.lastKillsText = killsText;
      this.kills.textContent = killsText;
    }

    this.updateHeat(world);

    if (debug !== undefined && !this.debug.hidden) {
      const text =
        `${debug.frameMs.toFixed(1)} ms  worst ${debug.worstMs.toFixed(1)}  x${debug.steps}\n` +
        `enemy ${debug.enemies}  shell ${debug.projectiles}  gem ${debug.pickups}\n` +
        `fx ${debug.effects}  sprites ${debug.sprites}  drop ${debug.droppedEvents}\n` +
        `beam ${world.beams.count}  weapons ${world.weaponCount}\n` +
        `tick ${world.tick}  run ${world.runSec.toFixed(1)}s  phase ${world.phase}`;
      if (text !== this.lastDebugText) {
        this.lastDebugText = text;
        this.debug.textContent = text;
      }
    }
  }

  /**
   * One chip per beam weapon held. Allocation-free in the steady state: every write is gated on a
   * QUANTISED value that has actually moved, so a laser sitting at 61.4% heat costs zero DOM work
   * and the countdown string is only built on the ten changes a second it really has.
   */
  private updateHeat(world: World): void {
    let n = 0;

    for (let i = 0; i < world.weaponCount && n < MAX_WEAPONS; i++) {
      const inst = world.weapons[i];
      if (inst === undefined) continue;
      const def = world.weaponCatalog[inst.defId];
      if (def === undefined || def.kind !== 'beam') continue;

      const chip = this.heatChips[n];

      // Rebind: only when this chip is showing a different weapon than it was, which happens
      // once, on the level-up that granted the laser.
      if (this.heatDefId[n] !== inst.defId) {
        this.heatDefId[n] = inst.defId;
        // The bar carries the beam's own colour, so bar and beam are visibly one weapon.
        chip.style.setProperty('--beam', cssColour(def.beamColour));
        this.heatNames[n].textContent = shortWeaponName(def.name);
        chip.setAttribute('aria-label', `${def.name} heat`);
        // Force the value writes below, so a rebind never inherits the previous weapon's fill.
        this.heatPct[n] = -1;
        this.heatOut[n] = -1;
        this.heatTenths[n] = -1;
      }

      const heat = inst.heat < 0 ? 0 : inst.heat > HEAT_MAX ? HEAT_MAX : inst.heat;
      // Quantised to whole percent: a sub-pixel move is invisible and still costs a style write.
      const pct = Math.round((heat / HEAT_MAX) * 100);
      if (pct !== this.heatPct[n]) {
        this.heatPct[n] = pct;
        this.heatFills[n].style.transform = `scaleX(${pct / 100})`;
      }

      const out = inst.overheated ? 1 : 0;
      if (out !== this.heatOut[n]) {
        this.heatOut[n] = out;
        chip.classList.toggle('heat--out', out === 1);
      }

      // Time until the weapon comes back. Cooling runs at the weapon's own heat rate
      // (constants.ts), so the wait is the slide from here down to HEAT_RESUME. Shown only while
      // cut out: before that the number is a hypothetical and the bar already tells the story.
      let tenths = -1;
      if (out === 1) {
        const rate = inst.stats.heatPerSec;
        const sec = rate > 0 ? (heat - HEAT_RESUME) / rate : 0;
        tenths = sec > 0 ? Math.ceil(sec * 10) : 0;
      }
      if (tenths !== this.heatTenths[n]) {
        this.heatTenths[n] = tenths;
        this.heatStatus[n].textContent = tenths < 0 ? '' : `OFFLINE ${(tenths / 10).toFixed(1)}s`;
      }

      n++;
    }

    // Only touches the DOM when the number of beam weapons actually changed.
    if (n !== this.heatShown) {
      for (let i = 0; i < MAX_WEAPONS; i++) this.heatChips[i].hidden = i >= n;
      this.heatRow.hidden = n === 0;
      this.heatShown = n;
    }
  }
}

/**
 * "Short Laser" -> "SHORT". The colour is the identity; this is the word that teaches it once.
 * Called only on a rebind, so the allocation is per weapon acquired, not per frame.
 */
function shortWeaponName(name: string): string {
  const space = name.indexOf(' ');
  return (space > 0 ? name.slice(0, space) : name).toUpperCase();
}

/** 0xRRGGBB -> '#rrggbb'. Rebind only. */
function cssColour(rgb: number): string {
  return `#${(rgb & 0xffffff).toString(16).padStart(6, '0')}`;
}

/** mm:ss. Never hh:mm:ss - a run is 15 minutes and an hours field would just be noise. */
export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function query<T extends HTMLElement = HTMLDivElement>(root: HTMLElement, selector: string): T {
  const el = root.querySelector<T>(selector);
  if (el === null) throw new Error(`hud: missing element ${selector}`);
  return el;
}
