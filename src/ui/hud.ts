/**
 * The in-run HUD: hull integrity, XP, level, clock, kills - plus the debug panel.
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

import { RUN_PHASE_INTRO, type World } from '../core/index.js';

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

    if (debug !== undefined && !this.debug.hidden) {
      const text =
        `${debug.frameMs.toFixed(1)} ms  worst ${debug.worstMs.toFixed(1)}  x${debug.steps}\n` +
        `enemy ${debug.enemies}  shell ${debug.projectiles}  gem ${debug.pickups}\n` +
        `fx ${debug.effects}  sprites ${debug.sprites}  drop ${debug.droppedEvents}\n` +
        `tick ${world.tick}  run ${world.runSec.toFixed(1)}s  phase ${world.phase}`;
      if (text !== this.lastDebugText) {
        this.lastDebugText = text;
        this.debug.textContent = text;
      }
    }
  }
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
