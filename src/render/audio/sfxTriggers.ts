/**
 * WHAT MAKES EACH NOISE - the wiring between the simulation's event ring and the sound library.
 *
 * ---------------------------------------------------------------------------------------------
 * SEPARATE FROM THE CATALOG ON PURPOSE
 * ---------------------------------------------------------------------------------------------
 * `sfxCatalog.ts` says which sounds exist and how loud they are; this says when they play. They
 * rot at different rates - a clip is commissioned once and a trigger is retuned every time the
 * game changes - and keeping them apart means a rebalance never touches the asset list.
 *
 * ---------------------------------------------------------------------------------------------
 * MOST EVENTS ARE SILENT, AND THAT IS THE DESIGN
 * ---------------------------------------------------------------------------------------------
 * The ring carries everything the simulation did. Sounding all of it would be a wall of noise
 * inside ten seconds: every spawn, every damage tick of every burn, every gem hitting the floor.
 * `null` here is a decision that something is a VISUAL fact, and the majority of the table is
 * null. The throttles in the catalog are the second line of defence, not the first.
 *
 * ---------------------------------------------------------------------------------------------
 * ROUTED RATHER THAN MAPPED, WHERE ONE EVENT MEANS SEVERAL SOUNDS
 * ---------------------------------------------------------------------------------------------
 * A kill is a grunt, an elite or a boss; a blast is small, medium or large; a consumable is four
 * different pickups. Those are functions below rather than rows here, because the discriminator
 * lives on the event payload and a table cannot see it.
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
import {
  PICKUP_KIND_CREDIT,
  PICKUP_KIND_DICE,
  PICKUP_KIND_MAGNET,
  PICKUP_KIND_REPAIR,
  PICKUP_KIND_REPAIR_CROSS,
} from '../../core/entity/pickupPool.js';
import { EVENT_SWARM } from '../../core/content/specialEvents.js';
import { HIT_ENERGY, HIT_INCENDIARY } from '../../core/systems/damage.js';
import type { WeaponId } from '../../core/index.js';
import { SFX_BY_ID, type SfxId } from './sfxCatalog.js';

/**
 * ONE SOUND PER EVENT KIND, or none. Routed kinds carry a fallback here and are overridden at the
 * call site by the functions below - a fallback rather than `null` so a router that is ever missed
 * still makes the right KIND of noise.
 */
export const EVENT_SFX: Readonly<Record<number, SfxId | null>> = Object.freeze({
  // ---- fires constantly; silence is the design -----------------------------------------------
  /** Every spawn, several a second all run. The horde arriving is a visual fact. */
  [EV_ENEMY_SPAWNED]: null,
  /** Every damage tick of every burn and pool. Hits are voiced by PROJECTILE_HIT instead. */
  [EV_ENEMY_DAMAGED]: null,
  /** One per kill, and the kill already speaks. A gem is heard when COLLECTED, not when dropped. */
  [EV_GEM_SPAWNED]: null,
  /** A round dying on a wall or a fuse with no blast. Nothing happened worth hearing. */
  [EV_PROJECTILE_EXPIRED]: null,
  /** The repair clock ticking. A drip, several times a minute, forever. */
  [EV_PLAYER_REPAIRED]: null,
  /** A rim quietly coming back. Its BREAKING is the event that changes what you do. */
  [EV_PLAYER_SHIELD_RESTORED]: null,
  /** A drum standing back up, deliberately out of sight. Hearing it would give the position away. */
  [EV_BARREL_GREW]: null,
  /** Bookkeeping. The overlay is the event. */
  [EV_WEAPON_COOLED]: null,
  [EV_WEAPON_RELOADING]: null,
  [EV_UPGRADE_REROLLED]: null,
  [EV_CHEST_CLOSED]: null,
  [EV_PHASE_CHANGED]: null,

  // ---- combat, outgoing ----------------------------------------------------------------------
  /** Routed by the firing weapon - see FIRE_SFX. The payload carries the slot. */
  [EV_WEAPON_FIRED]: null,
  /**
   * THE DRONE HAS ITS OWN CLIP NOW. Under the old five-class library it borrowed the machine
   * gun's, and the note here said the cost was a drone that could not be quieter than the gun it
   * shared with. Per-weapon firing pays that back: `fire_drone` sits at 0.22 against the machine
   * gun's 0.30, which is the number this comment was asking for.
   */
  [EV_DRONE_FIRED]: 'fire_drone',

  // ---- combat, arriving ----------------------------------------------------------------------
  /** Routed by damage type - see `hitSfxFor`. Falls back to solid. */
  [EV_PROJECTILE_HIT]: 'hit_bullet',
  /** A blast, graded by radius at the call site - see `blastSfxFor`. */
  [EV_PROJECTILE_DETONATED]: 'blast_medium',
  /** Routed by rank - see `deathSfxFor`. Falls back to the commonest. */
  [EV_ENEMY_KILLED]: 'die_grunt',
  [EV_BOSS_SPAWNED]: 'boss_warn',

  // ---- the mech ------------------------------------------------------------------------------
  [EV_PLAYER_DAMAGED]: 'player_hurt',
  [EV_PLAYER_SHIELD_BROKEN]: 'shield_break',
  /**
   * MECH INSURANCE FIRING, and it borrows the spanner rather than earning a clip.
   * The upgrade's own words are that the hull "comes back whole", which is what `pick_repair`
   * already sounds like - a system coming back online. The insurance shimmer on the mech and the
   * white immunity flicker are what say it was insurance and not a repair.
   */
  [EV_PLAYER_SAVED]: 'pick_repair',
  [EV_WEAPON_OVERHEATED]: 'overheat',
  [EV_WEAPON_RELOADED]: 'reload',

  // ---- the reward loop -----------------------------------------------------------------------
  [EV_GEM_COLLECTED]: 'pick_gem',
  /** Routed by kind - see `consumableSfxFor`. Falls back to the coin. */
  [EV_CONSUMABLE_TAKEN]: 'pick_credit',
  [EV_SHEEP_TAKEN]: 'pick_sheep',
  [EV_LEVEL_UP]: 'level_up',
  [EV_UPGRADE_TAKEN]: 'card_taken',
  [EV_CHEST_OPENED]: 'chest_open',

  // ---- the yard ------------------------------------------------------------------------------
  [EV_BARREL_BROKEN]: 'barrel_break',
  [EV_WALL_BROKEN]: 'wall_break',
  /** Routed by which event - see `specialEventSfxFor`. Only the swarm announces itself. */
  [EV_SPECIAL_EVENT]: null,
});

/**
 * WHAT EACH GUN SOUNDS LIKE. Fourteen weapons, fourteen clips, and no sharing.
 *
 * The three beams name their LOOP rather than a one-shot: a beam is held down, so the player
 * starts it when the weapon begins firing and stops it when the beam drops - see SFX_LOOPS and
 * the note on `loop` in the catalog. Everything else is fire-and-forget.
 */
export const FIRE_SFX: Readonly<Record<WeaponId, SfxId>> = Object.freeze({
  cannon: 'fire_cannon',
  'machine-gun': 'fire_mg',
  'flak-cannon': 'fire_flak',
  mortar: 'fire_mortar',
  artillery: 'fire_artillery',
  'missile-short': 'fire_missile_s',
  'missile-long': 'fire_missile_l',
  'laser-short': 'fire_laser_s',
  'laser-medium': 'fire_laser_m',
  'laser-long': 'fire_laser_l',
  'phase-cannon': 'fire_phase',
  plasma: 'fire_plasma',
  sludge: 'fire_sludge',
  drone: 'fire_drone',
});

/**
 * WHICH FIRING CLIP A SHOT EARNS, or null for one that must not fire a one-shot at all.
 *
 * TEN OF THE FOURTEEN FIRING CLIPS ARE REACHABLE ONLY THROUGH HERE. The drone has its own event
 * kind and the three beams are loops, so everything else in `FIRE_SFX` is played by resolving a
 * WEAPON_FIRED event's slot through this function - which is why it is a function in this file
 * rather than three lines inside the renderer's switch. It was those three lines once, and they
 * were an unconditional `return`: two thirds of the library was silent and every test still
 * passed, because the tables the tests assert against were all perfectly correct.
 *
 * A beam returns null because it is HELD rather than fired. It pushes a fire event every tick it
 * is on, and its sound is the loop `soundBeams` starts and stops; a one-shot here as well would
 * be a machine gun made of laser at sixty rounds a second.
 */
export function fireSfxFor(weaponId: WeaponId | undefined): SfxId | null {
  if (weaponId === undefined) return null;
  const id = FIRE_SFX[weaponId];
  if (id === undefined) return null;
  return SFX_BY_ID.get(id)?.loop === true ? null : id;
}

/**
 * BLAST GRADES, BY RADIUS. The boundaries are where the catalog's three clips stop being right,
 * not round numbers: a flak shell and a short missile are the same event to an ear, and an
 * artillery round is not a mortar round however close their radii get.
 */
export const BLAST_SMALL_MAX = 40;
export const BLAST_MEDIUM_MAX = 110;

export function blastSfxFor(splashRadius: number): SfxId {
  if (splashRadius <= BLAST_SMALL_MAX) return 'blast_small';
  if (splashRadius <= BLAST_MEDIUM_MAX) return 'blast_medium';
  return 'blast_large';
}

/**
 * IMPACT FOLLOWS THE DAMAGE TYPE, never the weapon - the element is already data on the gun, so
 * this is a lookup rather than a fifteenth recording. The class is decided in the simulation, at
 * the moment of the hit, and carried on the event's fifth payload: the projectile is long gone by
 * the time the renderer drains, so there is nowhere else to ask.
 *
 * `hit_laser` IS THE PHASE CANNON, not the beams. A beam pushes no hit event at all - its sound is
 * the loop that runs while it is held.
 */
export function hitSfxFor(hitKind: number): SfxId {
  if (hitKind === HIT_INCENDIARY) return 'hit_plasma';
  if (hitKind === HIT_ENERGY) return 'hit_laser';
  return 'hit_bullet';
}

/** A body going down, by rank. Three clips, and the commonest is the quietest and the shortest. */
export function deathSfxFor(rank: 'regular' | 'elite' | 'boss'): SfxId {
  if (rank === 'boss') return 'die_boss';
  if (rank === 'elite') return 'die_elite';
  return 'die_grunt';
}

/**
 * WHICH PICKUP WAS WALKED OVER. Both spanner grades share a clip: they are one item at two
 * strengths, and a player who can hear the difference would learn to want the loud one.
 */
export function consumableSfxFor(kind: number): SfxId | null {
  if (kind === PICKUP_KIND_CREDIT) return 'pick_credit';
  if (kind === PICKUP_KIND_REPAIR || kind === PICKUP_KIND_REPAIR_CROSS) return 'pick_repair';
  if (kind === PICKUP_KIND_MAGNET) return 'pick_magnet';
  if (kind === PICKUP_KIND_DICE) return 'pick_dice';
  return null;
}

/**
 * ONLY THE SWARM ANNOUNCES ITSELF.
 *
 * `nothing` is silence by definition. The ring attack and the chest elite both arrive as things
 * you can SEE - a ring closing, one gold body walking in - and a warning for each would spend the
 * player's attention on the two set-pieces that do not need it. The swarm is the one that comes
 * from off screen and is already on top of you by the time it is visible.
 */
export function specialEventSfxFor(id: number): SfxId | null {
  return id === EVENT_SWARM ? 'event_swarm' : null;
}

/**
 * SOUNDS THE INTERFACE FIRES, which the event ring never sees - a menu is not simulation. Named
 * here rather than left to each screen so the set is auditable in one place.
 */
export interface UiTrigger {
  readonly id: SfxId;
  readonly when: string;
}

export const UI_TRIGGERS: readonly UiTrigger[] = Object.freeze([
  { id: 'ui_move', when: 'selection moves between options' },
  { id: 'ui_confirm', when: 'a choice is committed - start run, collect, close' },
  { id: 'ui_deny', when: 'a locked chassis, an excluded weapon, or a reroll with none left' },
  { id: 'card_taken', when: 'a card is chosen - fires from the UI as well as the ring' },
  { id: 'achievement', when: 'an achievement unlocks, over whatever else is happening' },
  { id: 'ascend', when: 'a chest pays out a tier 8' },
  { id: 'run_won', when: 'the victory screen opens' },
  { id: 'run_lost', when: 'the run-over screen opens' },
]);
