/**
 * The in-run HUD: hull integrity, XP, level, clock, kills, laser heat, ammunition and reloads -
 * plus the debug panel.
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

import {
  WEAPON_SLOTS,
  RUN_PHASE_INTRO,
  weaponNameAtTier,
  type World,
} from '../core/index.js';

/**
 * THE LOADOUT ROW - one chip per weapon held, carrying its TIER and, for a laser, its HEAT.
 *
 * The lasers are a DUTY CYCLE, so the bar is the weapon: a player who cannot see heat cannot play
 * them. Four things have to read at a glance, mid-horde, without thinking:
 *
 *   1. WHICH LASER. The fill is the weapon's own `beamColour`, so the bar on the HUD and the line
 *      on the battlefield are obviously the same gun. No labels are needed to make that link -
 *      the name under the bar is for learning it the first time.
 *   2. THE RESUME LINE. Heat is HYSTERETIC: at `stats.heatCapacity` the weapon cuts out and does
 *      not come back until it has cooled to `stats.heatResume`. A bar that only showed "how full"
 *      would say a weapon just under its ceiling and one just over its resume line are nearly the
 *      same, when one is about to die for two seconds and the other is about to be fine. The
 *      notch is the whole mechanic made visible, and the tinted band above it is the region where
 *      cutting out is a real cost.
 *   3. OFFLINE, AND FOR HOW LONG. Overheating is a hard cut, not a fade, so it gets a hard visual
 *      state - and a countdown, because "it will come back" is useless without "in 2.4 s".
 * IT DOES NOT SAY WHAT TIER IT IS, and used to. A "T4" badge sat beside the name on the grounds
 * that every card in the pool is a weapon tier, so it was the only place a run's investment was
 * visible. It is gone: a number that only ever goes up is not information a player acts on
 * mid-fight, and the chip's job is to answer "can I shoot right now", which the bar already does.
 * The NAME still carries the one tier that changes what the weapon is - an ascension renames it.
 *
 * THE BAR IS SCALED TO THE WEAPON, NOT TO 100. Capacity is a per-weapon stat that tiers 3 and 6
 * raise, so the fill is `heat / stats.heatCapacity` and the notch sits at
 * `stats.heatResume / stats.heatCapacity` (injected as the `--resume` custom property). A
 * capacity tier therefore makes the bar represent MORE HEAT - a longer burst at the same visual
 * pace - rather than showing the same heat as a smaller fraction, which would read as the upgrade
 * having made the weapon cooler when it has not.
 *
 * A MAGAZINE WEAPON gets the same chip and the same bar, reading AMMUNITION. It has to: the
 * Machine Gun is the only weapon in the game that goes away completely, for 15 s at tier 1 and
 * 10.5 s at tier 7, and a fifteen-second silence with nothing on screen moving reads as a broken
 * gun rather than as a reload. The bar therefore does three jobs in sequence -
 *
 *   drains as rounds are spent, with the count in the footer, so the silence is never a surprise;
 *   empties, and the chip switches to its RELOAD state;
 *   refills as the reload runs, with a countdown, so "when do I get it back" always has an answer.
 *
 * IT IS A DIFFERENT STATE FROM OVERHEATED, and looks it. Overheating is a FAULT - hazard stripes,
 * warning red, a pulse. A reload is a procedure that is going to finish, so it is calm brass with
 * no pulse. Dressing them alike would teach the player either to panic on a reload or to shrug at
 * an overheat.
 *
 * THE BAR RUNS THE OTHER WAY from a laser's, and that is deliberate. Heat fills toward a cut-out;
 * ammunition drains toward one. "The bar going down means you are running out" is the one
 * convention every player already has, and inverting it to match the laser would be consistent
 * with the wrong thing.
 *
 * A COOLDOWN WEAPON - the Cannon, both missile racks, the artillery - gets a REARM bar and its
 * rearm TIME. The chip used to be trackless for these on the grounds that they had no reservoir
 * to show, which was true and beside the point: the thing a player wants to know about a rack
 * with a 4.2 s rearm is when the next salvo is coming, and there was nowhere on screen to read
 * it. The bar fills to full at the instant the weapon can fire again.
 *
 * The NUMBER beside it is the rearm time itself, not a countdown of it. The bar is already the
 * countdown; a Cannon's 0.84 s spent as a live readout would flicker through eight digits a
 * second and say nothing. The duration is the number worth having - it is the one thing a
 * fire-rate tier moves, and there is nowhere else in the game to read it.
 *
 * A weapon holding fire for want of a target sits at FULL rather than pretending to rearm:
 * `cooldownLeft` is only spent on a shot actually taken, so a Cannon with an empty field reads
 * ready, which is what it is.
 */


/**
 * The magazine chip's colour. Brass, and deliberately NOT any of the three beam colours or the
 * UI's own accent: the bar has to say "this is the kinetic gun" at a glance in a row that may
 * also be carrying a green, a blue and a red laser.
 */
const MAG_COLOUR = '#e0b34a';

/**
 * The cooldown chip's colour. Steel, and shared by the Cannon, both missile racks and the
 * artillery - they are one family, paced by one limiter, and giving each its own colour would
 * claim a difference the simulation does not make.
 */
const COOL_COLOUR = '#8fa3bb';

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
  private readonly alive: HTMLDivElement;
  private readonly hurt: HTMLDivElement;
  private readonly debug: HTMLPreElement;

  /** Loadout chips: built once at WEAPON_SLOTS, shown/hidden as weapons are acquired. */
  private readonly heatRow: HTMLDivElement;
  private readonly heatChips: HTMLDivElement[] = [];
  private readonly heatFills: HTMLDivElement[] = [];
  private readonly heatNames: HTMLSpanElement[] = [];
  private readonly heatStatus: HTMLSpanElement[] = [];
  /** Catalog index currently bound to each chip, or -1. Rebinding is what rewrites name/colour. */
  private readonly heatDefId = new Int32Array(WEAPON_SLOTS).fill(-1);
  /** Last written fill percent, overheated flag and countdown tenths. -1 forces the first write. */
  private readonly heatPct = new Int32Array(WEAPON_SLOTS).fill(-1);
  private readonly heatOut = new Int32Array(WEAPON_SLOTS).fill(-1);
  private readonly heatTenths = new Int32Array(WEAPON_SLOTS).fill(-1);
  /**
   * WHAT THE STATUS SLOT IS SAYING: 0 nothing, 1 a laser's OFFLINE countdown, 2 a magazine's
   * RELOADING countdown, 3 a magazine's round count.
   *
   * Paired with `heatTenths` (which carries the number) so the write is gated on the pair rather
   * than on the number alone. Without it, a magazine dropping to 12 rounds and a laser 1.2 s from
   * coming back would both cache as "12" and the second one would not repaint.
   */
  private readonly heatStatusMode = new Int32Array(WEAPON_SLOTS).fill(-1);
  /** Last written tier and resume-notch percent - both move only on a level-up. */
  private readonly heatLevel = new Int32Array(WEAPON_SLOTS).fill(-1);
  private readonly heatResumePct = new Int32Array(WEAPON_SLOTS).fill(-1);
  private heatShown = -1;

  private lastHpText = '';
  private lastLevelText = '';
  private lastTimerText = '';
  private lastKillsText = '';
  private lastAliveText = '';
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
        <div class="hud__alive" data-alive aria-label="Enemies on the field">0 live</div>
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
    this.alive = query(el, '[data-alive]');
    this.hurt = query(el, '[data-hurt]');
    this.debug = query<HTMLPreElement>(el, '[data-debug]');

    // Chips are built ONCE, at the slot cap, and then only shown/hidden and rewritten. Creating
    // DOM at the moment a laser is picked would put a layout+style recalc inside the level-up
    // transition, which is exactly when a dropped frame is most visible.
    const heatRow = query(el, '[data-heat]');
    heatRow.hidden = true;
    this.heatRow = heatRow;
    for (let i = 0; i < WEAPON_SLOTS; i++) {
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

    // Credits ride alongside the kill count rather than getting a row of their own: they are a
    // score, not a resource the player spends in-run, and the HUD's whole job on a phone is to
    // stay out of the way of the field. Hidden entirely until the first coin, so a player who
    // never breaks a barrel never sees a zero they have to wonder about.
    const credits = world.stats.credits;
    const killsText =
      credits > 0 ? `${world.stats.kills} kills   ${credits}c` : `${world.stats.kills} kills`;
    if (killsText !== this.lastKillsText) {
      this.lastKillsText = killsText;
      this.kills.textContent = killsText;
    }

    // HOW MANY ARE STILL COMING, which is the one number on this HUD about the present rather than
    // about the past. Kills is what the run has achieved; this is what it is standing in, and it is
    // the difference between "a wave is building" and "the wave broke" long before either is
    // visible at the edge of a phone screen.
    //
    // `enemies.count` is the DENSE count - the pool swap-removes on death, so live bodies are
    // exactly [0, count) with no holes and nothing has to be filtered. Corpses mid-reap are already
    // gone from it.
    //
    // Compared as a string like the others: this changes on most ticks, and the guard is what keeps
    // that from being a DOM write sixty times a second when it has not actually moved.
    const aliveText = `${world.enemies.count} live`;
    if (aliveText !== this.lastAliveText) {
      this.lastAliveText = aliveText;
      this.alive.textContent = aliveText;
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
   * One chip per weapon held. Allocation-free in the steady state: every write is gated on a
   * QUANTISED value that has actually moved, so a laser sitting at 61.4% heat costs zero DOM work
   * and the countdown string is only built on the ten changes a second it really has.
   */
  private updateHeat(world: World): void {
    let n = 0;

    for (let i = 0; i < world.weaponCount && n < WEAPON_SLOTS; i++) {
      const inst = world.weapons[i];
      if (inst === undefined) continue;
      const def = world.weaponCatalog[inst.defId];
      if (def === undefined) continue;
      const beam = def.kind === 'beam';
      const stats = inst.stats;
      // A MAGAZINE WEAPON gets the same chip and the same bar, reading AMMUNITION instead of
      // heat. The two are opposite in direction on purpose - a heat bar fills toward a cut-out,
      // an ammo bar drains toward one - because "the bar going down means you are running out" is
      // the one convention a player already has, and inverting it to match the laser would be
      // consistent with the wrong thing.
      const mag = stats.ammoCapacity > 0;
      // EVERY OTHER PROJECTILE WEAPON is paced by a COOLDOWN, and its bar is that: how far
      // through rearming it is, filling to full when it is ready to fire. The Cannon, both
      // missile racks and the artillery share it, because they share the limiter - splitting the
      // racks out would be inventing a distinction the simulation does not make.
      const cool = !beam && !mag;

      const chip = this.heatChips[n];

      // Rebind: when this chip is showing a different weapon than it was, OR when the one it is
      // showing has changed tier.
      //
      // THE TIER HALF IS NOT DECORATION. A weapon's NAME is a function of its tier - a Medium
      // Laser at 8 is a Chain Laser - and rebinding on `defId` alone never re-derives it, because
      // an ascension is the same WeaponDef at a higher level. The chip read MED LASER for the
      // rest of the run. It went unnoticed because the tier badge beside it was tracked
      // separately and did update, so the chip said "MED LASER T8" and only half of that was
      // wrong. Removing the badge is what made it worth fixing rather than merely true.
      if (this.heatDefId[n] !== inst.defId || this.heatLevel[n] !== inst.level) {
        this.heatDefId[n] = inst.defId;
        this.heatLevel[n] = inst.level;
        // The bar carries the beam's own colour, so bar and beam are visibly one weapon. A
        // projectile weapon has no beam colour at all (0x000000 would paint the chip black), so
        // the property is removed and the stylesheet's neutral default applies.
        if (beam) chip.style.setProperty('--beam', cssColour(def.beamColour));
        else if (mag) chip.style.setProperty('--beam', MAG_COLOUR);
        else chip.style.setProperty('--beam', COOL_COLOUR);
        // Both suppress the resume notch, which is a property of a beam's hysteresis and means
        // nothing to a magazine or a cooldown.
        chip.classList.toggle('heat--mag', mag);
        chip.classList.toggle('heat--cool', cool);
        // The TIER decides the name: a Medium Laser at 8 is a Chain Laser, and the chip is the
        // one place the player reads what they are carrying. Falls back to the catalog name if
        // the weapon has no card, which no shipping weapon does.
        this.heatNames[n].textContent = shortWeaponName(
          weaponNameAtTier(def.id, inst.level) || def.name,
        );
        // The chip's spoken identity. NO TIER IN IT: the badge that used to carry the number is
        // gone from the chip, and a label that announces something the screen does not show is a
        // readout of a different HUD.
        chip.setAttribute(
          'aria-label',
          `${def.name}${beam ? ' heat' : mag ? ' ammunition' : ''}`,
        );
        // Force the value writes below, so a rebind never inherits the previous weapon's fill.
        this.heatPct[n] = -1;
        this.heatOut[n] = -1;
        this.heatTenths[n] = -1;
        this.heatStatusMode[n] = -1;
        this.heatResumePct[n] = -1;
      }


      // CAPACITY IS THE WEAPON'S OWN, so the bar means "how close is this gun to cutting out"
      // rather than "how many points of heat" - and a capacity tier lengthens the burst instead
      // of shortening the bar.
      const capacity = stats.heatCapacity > 0 ? stats.heatCapacity : 1;
      const heat = inst.heat < 0 ? 0 : inst.heat > capacity ? capacity : inst.heat;
      const reloading = mag && inst.reloadLeft > 0;

      // WHAT THE BAR IS SHOWING, in one expression per weapon family:
      //   magazine, reloading  the magazine REFILLING - 0 at the moment it ran dry, 1 as the
      //                        last round goes in. This is the whole point of the change: a
      //                        fifteen-second silence with no bar moving reads as a broken gun.
      //   magazine, loaded     rounds left, draining as they are spent.
      //   beam                 heat, rising toward this weapon's own cut-out.
      // Quantised to whole percent: a sub-pixel move is invisible and still costs a style write.
      let pct: number;
      if (reloading) {
        const total = stats.reloadTime > 0 ? stats.reloadTime : 1;
        const done = 1 - inst.reloadLeft / total;
        pct = Math.round((done < 0 ? 0 : done > 1 ? 1 : done) * 100);
      } else if (mag) {
        const rounds = inst.ammo < 0 ? stats.ammoCapacity : inst.ammo;
        pct = Math.round((rounds / stats.ammoCapacity) * 100);
      } else if (cool) {
        // REARM PROGRESS, filling to full at the moment the weapon can fire again - the same
        // direction as a reload, because it is the same promise. A weapon holding fire for want
        // of a target sits at full: `cooldownLeft` is only spent on a shot actually taken, so a
        // Cannon with nothing in range reads READY rather than pretending to rearm.
        const total = stats.cooldown > 0 ? stats.cooldown : 1;
        const left = inst.cooldownLeft > 0 ? inst.cooldownLeft : 0;
        const done = 1 - left / total;
        pct = Math.round((done < 0 ? 0 : done > 1 ? 1 : done) * 100);
      } else {
        pct = Math.round((heat / capacity) * 100);
      }
      if (pct !== this.heatPct[n]) {
        this.heatPct[n] = pct;
        this.heatFills[n].style.transform = `scaleX(${pct / 100})`;
      }

      // The resume notch and the tinted "cutting out costs you" band, both driven off the
      // weapon's own threshold rather than a hardcoded half. It only moves when heatResume or
      // heatCapacity does - i.e. on a capacity tier - so this is a per-level-up write.
      const resumePct = Math.round((stats.heatResume / capacity) * 100);
      if (resumePct !== this.heatResumePct[n]) {
        this.heatResumePct[n] = resumePct;
        chip.style.setProperty('--resume', `${resumePct}%`);
      }

      // Two states, one slot, and they cannot both be true: a beam has no magazine and a
      // magazine weapon never overheats. 0 live, 1 cut out, 2 reloading.
      const out = inst.overheated ? 1 : reloading ? 2 : 0;
      if (out !== this.heatOut[n]) {
        this.heatOut[n] = out;
        chip.classList.toggle('heat--out', out === 1);
        chip.classList.toggle('heat--reload', out === 2);
      }

      // Time until the weapon comes back: the slide from here down to its resume threshold at its
      // own DISPERSION rate - not its generation rate, which is a different number the moment a
      // tier is taken. Shown only while cut out: before that the number is a hypothetical and the
      // bar already tells the story.
      //
      // A RELOAD IS THE SAME PROMISE, with a different reason and a much longer number: the
      // Machine Gun is away for 15 s at tier 1 and 10.5 s at tier 7, which is the longest any
      // weapon in the game is gone. It gets the same treatment - a countdown, tenths of a second
      // - because "it will come back" is exactly as useless here.
      //
      // A LOADED magazine shows its round count instead. It is the only number that tells you
      // whether the silence is coming in two seconds or twenty, and there is nowhere else in the
      // game to read it.
      let mode = 0;
      let value = -1;
      if (out === 1) {
        const rate = stats.heatDispersion;
        const sec = rate > 0 ? (heat - stats.heatResume) / rate : 0;
        mode = 1;
        value = sec > 0 ? Math.ceil(sec * 10) : 0;
      } else if (out === 2) {
        mode = 2;
        value = inst.reloadLeft > 0 ? Math.ceil(inst.reloadLeft * 10) : 0;
      } else if (mag) {
        mode = 3;
        value = inst.ammo < 0 ? stats.ammoCapacity : inst.ammo;
      } else if (cool) {
        // THE REARM TIME ITSELF, not a countdown of it. The bar is already the countdown, and a
        // Cannon's 0.84 s would spend its life flickering through eight digits a second for no
        // information; the DURATION is the number a player actually wants, it is the one thing a
        // fire-rate tier moves, and there is nowhere else in the game to read it. Carried in
        // hundredths so the cache stays integer.
        mode = 4;
        value = Math.round(stats.cooldown * 100);
      }
      if (mode !== this.heatStatusMode[n] || value !== this.heatTenths[n]) {
        this.heatStatusMode[n] = mode;
        this.heatTenths[n] = value;
        this.heatStatus[n].textContent =
          mode === 1
            ? `OFFLINE ${(value / 10).toFixed(1)}s`
            : mode === 2
              ? `RELOAD ${(value / 10).toFixed(1)}s`
              : mode === 3
                ? String(value)
                : mode === 4
                  ? `${(value / 100).toFixed(2)}s`
                  : '';
      }

      n++;
    }

    // Only touches the DOM when the number of beam weapons actually changed.
    if (n !== this.heatShown) {
      for (let i = 0; i < WEAPON_SLOTS; i++) this.heatChips[i].hidden = i >= n;
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
