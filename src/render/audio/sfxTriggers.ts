/**
 * EVERY PLACE THE GAME WILL MAKE A NOISE, and which noise it makes.
 *
 * The catalog next door says what sounds EXIST. This says when each one fires. They are separate
 * files because they are separate decisions and they rot at different rates: a clip is commissioned
 * once, while the moment it plays on gets argued about for as long as the game is tuned.
 *
 * ---------------------------------------------------------------------------------------------
 * NEARLY EVERY TRIGGER IS AN EVENT CORE ALREADY EMITS
 * ---------------------------------------------------------------------------------------------
 * `src/core/` is deterministic and cannot know what a speaker is - but it already publishes what
 * happened, every tick, through the event ring, and the renderer already drains that ring to place
 * muzzle flashes and death puffs. Sound is one more listener on a seam that exists.
 *
 * That is the whole architecture, and it buys three things worth naming: the simulation cannot be
 * changed by whether the player is wearing headphones; a replay is silent or loud and still the same
 * replay; and a sound that fires at the wrong moment is a bug in ONE table rather than a stray call
 * buried in a system.
 *
 * ---------------------------------------------------------------------------------------------
 * `EVENT_SFX` IS TOTAL, AND THAT IS THE POINT OF IT
 * ---------------------------------------------------------------------------------------------
 * It is a `Record` over every event kind, so a new event added to the ring is a COMPILE ERROR here
 * until somebody decides whether it makes a noise. `null` is a real answer and means "deliberately
 * silent" - each one carries the reason, because "no sound yet" and "no sound ever" look identical
 * in a table six months later and only one of them is a bug.
 *
 * ---------------------------------------------------------------------------------------------
 * WHAT IS NOT HERE
 * ---------------------------------------------------------------------------------------------
 * The four UI sounds fire from the UI, not from the ring: a menu keypress is not a simulation
 * event and never reaches core. They are listed at the bottom as call sites rather than as a map,
 * because a button knows its own sound and there is nothing to look up.
 *
 * NOTHING IN THIS FILE PLAYS ANYTHING YET. There are no audio files - see the catalog's header.
 * These tables are the specification the player will be built against.
 */

import {
  EV_BARREL_BROKEN,
  EV_BARREL_GREW,
  EV_BOSS_SPAWNED,
  EV_CHEST_CLOSED,
  EV_CHEST_OPENED,
  EV_CONSUMABLE_TAKEN,
  EV_DRONE_FIRED,
  EV_ENEMY_DAMAGED,
  EV_ENEMY_KILLED,
  EV_ENEMY_SPAWNED,
  EV_GEM_COLLECTED,
  EV_GEM_SPAWNED,
  EV_LEVEL_UP,
  EV_PHASE_CHANGED,
  EV_PLAYER_DAMAGED,
  EV_PLAYER_REPAIRED,
  EV_PLAYER_SAVED,
  EV_PLAYER_SHIELD_BROKEN,
  EV_PLAYER_SHIELD_RESTORED,
  EV_PROJECTILE_DETONATED,
  EV_PROJECTILE_EXPIRED,
  EV_PROJECTILE_HIT,
  EV_SHEEP_TAKEN,
  EV_SPECIAL_EVENT,
  EV_UPGRADE_REROLLED,
  EV_UPGRADE_TAKEN,
  EV_WALL_BROKEN,
  EV_WEAPON_COOLED,
  EV_WEAPON_FIRED,
  EV_WEAPON_OVERHEATED,
  EV_WEAPON_RELOADED,
  EV_WEAPON_RELOADING,
} from '../../core/events/ring.js';
import type { WeaponId } from '../../core/index.js';
import type { SfxId } from './sfxCatalog.js';

/**
 * ONE SOUND PER EVENT KIND, or `null` for the ones that stay silent.
 *
 * THE SILENT ONES ARE THE INTERESTING HALF. Every `null` below is a decision about restraint, and
 * most of them are the same decision: the event fires far too often to be heard. `ENEMY_DAMAGED`
 * happens for every tick of every burn on every body; `GEM_SPAWNED` happens for every kill. A sound
 * on either would be a solid tone.
 */
export const EVENT_SFX: Readonly<Record<number, SfxId | null>> = Object.freeze({
  // ---- fires constantly; silence is the design ------------------------------------------------
  /** Every spawn, several a second all run. The horde arriving is a visual fact, not an audible one. */
  [EV_ENEMY_SPAWNED]: null,
  /** Every damage tick of every burn and pool. Hits are voiced by PROJECTILE_HIT instead. */
  [EV_ENEMY_DAMAGED]: null,
  /** One per kill, and the kill already speaks. The gem is heard when COLLECTED, not when dropped. */
  [EV_GEM_SPAWNED]: null,

  // ---- combat, outgoing --------------------------------------------------------------------------
  /** Routed by the firing weapon's class - see `fireSfxFor`. The payload carries the slot. */
  [EV_WEAPON_FIRED]: null,
  /**
   * THE SAME LIGHT REPORT THE MACHINE GUN USES. A drone had its own clip until the firing family
   * was audited and four sounds turned out to serve one weapon each. The cost is real and worth
   * stating: a drone should be the quietest gun on the field, and sharing a clip means sharing its
   * 0.35 gain rather than the 0.22 it wanted. If four drones prove too loud in play, the fix is a
   * per-trigger gain scale - one number - and NOT a fifth firing clip.
   */
  [EV_DRONE_FIRED]: 'fire_light',

  // ---- combat, arriving ----------------------------------------------------------------------------
  /** Routed by beam vs shell - see `hitSfxFor`. Falls back to kinetic. */
  [EV_PROJECTILE_HIT]: 'hit_kinetic',
  /** A blast. Graded by radius at the call site - see `blastSfxFor`. */
  [EV_PROJECTILE_DETONATED]: 'blast_medium',
  /** A round dying on a wall or a fuse with no blast. Nothing happened worth hearing. */
  [EV_PROJECTILE_EXPIRED]: null,

  // ---- bodies -----------------------------------------------------------------------------------------
  /** Graded elite/regular at the call site - see `deathSfxFor`. */
  [EV_ENEMY_KILLED]: 'enemy_die',
  [EV_BOSS_SPAWNED]: 'boss_spawn',
  [EV_PLAYER_DAMAGED]: 'player_hurt',
  [EV_PLAYER_SHIELD_BROKEN]: 'shield_break',
  [EV_PLAYER_SHIELD_RESTORED]: 'shield_restore',
  /** Mech Insurance paying out. Reuses the shield's restore rather than earning a clip of its own. */
  [EV_PLAYER_SAVED]: 'shield_restore',
  /** A spanner healing the mech. The pickup that caused it already sounded; a second sound doubles it. */
  [EV_PLAYER_REPAIRED]: null,

  // ---- weapon state -----------------------------------------------------------------------------------
  [EV_WEAPON_OVERHEATED]: 'weapon_overheat',
  /**
   * THE BREAKER RESETTING, AND IT SAYS NOTHING. It had a clip; it does not need one. `overheat` has
   * already told the player the gun is gone, the heat bar is visibly draining toward its resume
   * notch the whole time, and the beam AUDIBLY restarting is itself the recovery - a sound on top of
   * that is a third telling of the same fact. Cut deliberately rather than left unsourced.
   */
  [EV_WEAPON_COOLED]: null,
  /** The START of a reload is silent: the gun going quiet IS the signal, and it is about to be long. */
  [EV_WEAPON_RELOADING]: null,
  [EV_WEAPON_RELOADED]: 'weapon_reloaded',

  // ---- the reward loop -----------------------------------------------------------------------------------
  [EV_GEM_COLLECTED]: 'gem_pickup',
  [EV_CONSUMABLE_TAKEN]: 'consumable_pickup',
  [EV_BARREL_BROKEN]: 'barrel_break',
  /** A sheep taken. The same splintering as a drum - it is the same act, and the animal needs no voice. */
  [EV_SHEEP_TAKEN]: 'barrel_break',
  /** A drum standing back up, deliberately off screen. Hearing it would give away where it grew. */
  [EV_BARREL_GREW]: null,
  [EV_LEVEL_UP]: 'level_up',
  [EV_UPGRADE_TAKEN]: 'upgrade_taken',
  /** A reroll. Voiced by the UI's own confirm, which is already under the player's thumb. */
  [EV_UPGRADE_REROLLED]: null,
  [EV_CHEST_OPENED]: 'chest_open',
  /** Closing a chest is the player leaving a screen; the UI confirm covers it. */
  [EV_CHEST_CLOSED]: null,

  // ---- the world -------------------------------------------------------------------------------------------
  [EV_WALL_BROKEN]: 'wall_break',
  [EV_SPECIAL_EVENT]: 'event_warn',
  /**
   * Run phase changes. The one that matters - dying - is voiced at the call site, because this
   * event fires for every transition including the intro and the level-up freeze, and only one of
   * them is worth a sound.
   */
  [EV_PHASE_CHANGED]: null,
});

/**
 * WHICH REPORT A GUN MAKES, by class rather than by weapon.
 *
 * Fourteen guns, eight sounds. Total over `WeaponId`, so a new weapon cannot ship without somebody
 * deciding what it sounds like - the same guarantee `EVENT_SFX` gives for events.
 *
 * THE THREE LASERS ARE NOT HERE. A beam is not fired, it is HELD: it starts a loop and stops it,
 * which is a different call and lives with the beam layer. Giving them a per-shot entry would fire
 * `beam_loop` sixty times a second.
 */
export const FIRE_SFX: Readonly<Record<WeaponId, SfxId | null>> = Object.freeze({
  cannon: 'fire_heavy',
  mortar: 'fire_heavy',
  artillery: 'fire_heavy',
  'machine-gun': 'fire_light',
  // THE ONE DELIBERATE PER-WEAPON SOUND. Everything else in this table is by class, and the rule
  // that no clip may serve a single gun is enforced in tests/sfx.test.ts - this is its only
  // declared exception. The Machine Gun and the Flak Cannon share the rotary mount, fire at similar
  // rates and look alike on the chassis, so with one shared report a player holding both cannot
  // tell which of them is working. That is the whole argument, and it does not generalise: a second
  // gun wanting its own voice has to make the case again.
  'flak-cannon': 'fire_flak',
  'missile-short': 'fire_missile',
  'missile-long': 'fire_missile',
  'phase-cannon': 'fire_energy',
  // THE TWO COMPROMISES, named rather than hidden. Neither is the right sound; both are the
  // least-wrong one available, and buying the right one costs a clip that serves a single gun.
  //
  // The Plasma Thrower lobs a slow exotic bolt, so it takes the exotic report. What is lost is the
  // breathiness - it will read as a charged shot rather than a gout of flame.
  plasma: 'fire_energy',
  // Toxic Sludge is a wet arc over the shoulder, which is not a rocket. It sits with the missiles
  // because that is the "launched, travels, is not a bang" bucket; the alternative was the heavy
  // shell, and a bang is further from a lob than a launch is.
  sludge: 'fire_missile',
  // See EV_DRONE_FIRED above for the gain this gives up.
  drone: 'fire_light',
  'laser-short': null,
  'laser-medium': null,
  'laser-long': null,
});

/**
 * WHICH BLAST GRADE A RADIUS EARNS. The Vampire Survivors lesson, applied: a new weapon with a
 * blast needs no new audio, it needs a SIZE.
 *
 * The two thresholds are read off the shipping catalog rather than picked: the Phase Cannon's burst
 * runs 55-79 u and the Plasma Thrower's 26, so `small` covers the incidental blasts, `medium` the
 * deliberate ones, and `large` is the artillery and the Mortar alone.
 */
export const BLAST_SMALL_MAX = 40;
export const BLAST_MEDIUM_MAX = 110;

export function blastSfxFor(splashRadius: number): SfxId {
  if (splashRadius <= BLAST_SMALL_MAX) return 'blast_small';
  if (splashRadius <= BLAST_MEDIUM_MAX) return 'blast_medium';
  return 'blast_large';
}

/**
 * WHICH ARRIVAL A ROUND MAKES: two answers, and the split is beam against everything else.
 *
 * THERE WAS A THIRD, AND IT SERVED ONE WEAPON. `hit_fire` played on ignition, which only the Plasma
 * Thrower causes - a dedicated clip for one gun's mechanic in a table whose stated rule is that
 * impacts follow the damage type rather than the weapon.
 *
 * Losing it costs less than it looks like: a body catching fire is the most VISIBLE status in the
 * game - it wears flames, several of them, and they gutter as the burn runs out. The sound was
 * saying a thing the screen already says loudly. If ignition ever needs its own voice it should
 * arrive as a layer over the normal arrival rather than as a replacement for it.
 */
export function hitSfxFor(opts: { readonly beam: boolean }): SfxId {
  return opts.beam ? 'hit_energy' : 'hit_kinetic';
}

/** Elites and bosses get the heavier confirmation; everything else shares one clip. */
export function deathSfxFor(ranked: boolean): SfxId {
  return ranked ? 'enemy_die_elite' : 'enemy_die';
}

/**
 * THE UI CALL SITES, which no event reaches.
 *
 * A LIST RATHER THAN A MAP, because there is nothing to look up: each of these is one call in one
 * place, and writing them down here is what stops the set drifting apart from the catalog. The
 * `where` column is the file that will own the call.
 */
export interface UiTrigger {
  readonly sfx: SfxId;
  readonly where: string;
  readonly when: string;
}

export const UI_TRIGGERS: readonly UiTrigger[] = Object.freeze([
  { sfx: 'ui_move', where: 'heroPicker / scrapopediaScreen / pauseMenu', when: 'selection moves between options' },
  { sfx: 'ui_confirm', where: 'every screen with a primary button', when: 'a choice is committed - start run, collect, close' },
  { sfx: 'ui_deny', where: 'heroPicker, levelUpOverlay', when: 'a locked chassis or an excluded weapon is pressed, or a reroll with none left' },
  { sfx: 'upgrade_taken', where: 'levelUpOverlay', when: 'a card is chosen - fires from the UI as well as the ring, whichever lands first wins the throttle' },
  { sfx: 'ui_confirm', where: 'chestOverlay', when: 'the reels are skipped, and again when the payout is collected' },
] as const) as readonly UiTrigger[];
