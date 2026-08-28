/**
 * THE SOUND LIBRARY - what noises this game is allowed to make, and nothing about when.
 *
 * ---------------------------------------------------------------------------------------------
 * THERE ARE NO AUDIO FILES YET, AND THAT IS THE POINT OF DOING THIS FIRST
 * ---------------------------------------------------------------------------------------------
 * Every entry names a `clip` that does not exist on disk. The table is the DECISION - which sounds
 * the game needs, what each is for, how loud, how often it may repeat - taken before anybody spends
 * money or time on recordings. When assets arrive they are dropped in against these keys and
 * nothing else moves; if a sound turns out not to be worth having, it is deleted here and every
 * trigger that named it becomes a compile error rather than a silent hole.
 *
 * ---------------------------------------------------------------------------------------------
 * WHY THE LIBRARY IS THIS SMALL
 * ---------------------------------------------------------------------------------------------
 * Vampire Survivors ships 222 clips; this is 30, and the difference is not ambition. Three rules from
 * that teardown do most of the compressing:
 *
 *   EXPLOSIONS ARE GRADED, NOT SOURCED. `blast_small|medium|large` is chosen by the shell's own
 *   `splashRadius`, so the Mortar, the artillery, the Phase Cannon and a flak burst share three
 *   clips between them and a NEW weapon needs no new audio - it needs a size.
 *
 *   IMPACT FOLLOWS THE DAMAGE TYPE, NOT THE WEAPON. One kinetic, one energy, one incendiary. The
 *   element is already data on the weapon (`burn`, `slow`), so the clip is a lookup rather than a
 *   fourteenth recording.
 *
 *   NO SOUND MAY SERVE ONE WEAPON. The first draft of this table broke its own rule the moment it
 *   reached the guns: the Plasma Thrower got a firing clip AND an ignition clip to itself, the
 *   Toxic Sludge and the drone bay one each, and "firing is the one place per-weapon detail
 *   survives" turned out to be an exception granted rather than a principle. Nine effects and 29%
 *   of every file in the library were a gun going off. Four of them served exactly one gun.
 *
 *   They are gone. FIRING IS BY CLASS AND ONLY BY CLASS: five sounds cover fourteen guns, and
 *   where the fit is imperfect that is what minimal costs - see FIRE_SFX for the two compromises
 *   this forces and why each was the least-wrong option rather than the right one.
 *
 * ---------------------------------------------------------------------------------------------
 * `tier` IS THE MINIMAL SET, STATED IN THE TABLE
 * ---------------------------------------------------------------------------------------------
 * `core` is the eighteen sounds without which the game reads as broken rather than as quiet - a
 * shot with no report, a kill with no confirmation. `extended` is everything that makes it good.
 * Splitting them here rather than in a document means the first commission can be filtered out of
 * the catalog itself, and nobody has to remember which was which.
 *
 * ---------------------------------------------------------------------------------------------
 * THIS IS RENDER-LAYER DATA AND MUST STAY THERE
 * ---------------------------------------------------------------------------------------------
 * `src/core/` is a deterministic simulation that does not know what a speaker is, and sound must
 * never influence it. Core already says what happened through the event ring; this layer listens.
 * That is also why nothing here is in the world hash and why a muted run and a loud one are the
 * same run. The C# front-end will need its own copy of this table, exactly as it has its own
 * RenderTables - it is presentation, and the port owns its presentation.
 */

/** Every sound the game may make. A trigger naming anything else does not compile. */
export type SfxId =
  // ---- firing, by weapon CLASS -------------------------------------------------------------
  | 'fire_light'
  | 'fire_flak'
  | 'fire_heavy'
  | 'fire_missile'
  | 'fire_energy'
  | 'beam_loop'
  // ---- what a round does when it arrives ----------------------------------------------------
  | 'hit_kinetic'
  | 'hit_energy'
  | 'blast_small'
  | 'blast_medium'
  | 'blast_large'
  // ---- the horde -----------------------------------------------------------------------------
  | 'enemy_die'
  | 'enemy_die_elite'
  | 'boss_spawn'
  // ---- the mech ------------------------------------------------------------------------------
  | 'player_hurt'
  | 'player_die'
  | 'shield_break'
  | 'shield_restore'
  // ---- weapons telling you their state --------------------------------------------------------
  | 'weapon_overheat'
  | 'weapon_reloaded'
  // ---- the reward loop -------------------------------------------------------------------------
  | 'gem_pickup'
  | 'consumable_pickup'
  | 'barrel_break'
  | 'level_up'
  | 'upgrade_taken'
  | 'chest_open'
  // ---- the world -------------------------------------------------------------------------------
  | 'wall_break'
  | 'event_warn'
  // ---- menus -----------------------------------------------------------------------------------
  | 'ui_move'
  | 'ui_confirm'
  | 'ui_deny';

export type SfxTier = 'core' | 'extended';

export type SfxBus = 'weapon' | 'impact' | 'body' | 'pickup' | 'ui' | 'world';

export interface SfxDef {
  readonly id: SfxId;
  /**
   * THE ASSET KEY A FILE WILL ONE DAY ANSWER TO, and there is no file today. Named rather than left
   * blank so the naming convention is decided now: `sfx_<id>`, one flat namespace, no folders. A
   * loader that cannot resolve one logs once and plays silence - see the note at the top of this
   * file about what happens when a clip is deleted.
   */
  readonly clip: string;
  readonly tier: SfxTier;
  /** Which mixer group it belongs to. The player will get one volume slider per bus, not per clip. */
  readonly bus: SfxBus;
  /** What this sound is FOR, in the words a brief would use. This is the commission text. */
  readonly brief: string;
  /**
   * HOW MANY TAKES TO RECORD. Anything that can fire twice in a second needs more than one or the
   * ear starts hearing the FILE rather than the event - the pattern Vampire Survivors spends its
   * A/B pairs on. 1 means "this can never repeat quickly enough to matter".
   */
  readonly takes: number;
  /**
   * THE FLOOR BETWEEN TWO PLAYS OF THIS SOUND, in milliseconds. THE SINGLE MOST IMPORTANT COLUMN
   * HERE, and the one a horde game cannot skip: forty runts dying in a tick is forty `enemy_die`
   * requests, and playing all of them is not loud, it is WHITE NOISE - and forty decode calls on a
   * phone besides. The number is per-sound rather than global because the right answer differs by
   * two orders of magnitude between a Machine Gun round and a boss arriving.
   *
   * 0 means "never throttle" and is reserved for things that genuinely cannot double up.
   */
  readonly throttleMs: number;
  /**
   * Baseline gain, 0..1, before the bus fader. A guide for whoever mixes rather than a final value -
   * but the RELATIVE numbers are a design decision and should survive mixing: a gem must never be
   * as loud as a boss.
   */
  readonly gain: number;
  /** True for the two sounds that run until told to stop rather than firing once. */
  readonly loop?: boolean;
}

/**
 * THE LIBRARY. Ordered by bus, then roughly by how often it will be heard.
 *
 * A NOTE ON THE THROTTLES, because they are the numbers most likely to be argued with: they are
 * derived from what the simulation can actually produce, not guessed. The Machine Gun at tier 7
 * fires about 23 times a second, so `fire_light` at 60 ms plays roughly every third round and the
 * rest are dropped - which is what a burst is supposed to sound like. `hit_kinetic` is looser at
 * 45 ms because hits are already spread across a crowd. `enemy_die` at 80 ms is the one that keeps
 * a wave-clear from becoming a wall of noise.
 */
export const SFX_CATALOG: readonly SfxDef[] = Object.freeze([
  // ---- WEAPONS FIRING ------------------------------------------------------------------------
  {
    id: 'fire_light', clip: 'sfx_fire_light', tier: 'core', bus: 'weapon', takes: 4, throttleMs: 60, gain: 0.35,
    brief: 'A single light automatic report. Dry, short, no tail - it will be heard twenty times a second and any ring in it becomes a drone. Machine Gun and Flak Cannon.',
  },
  {
    id: 'fire_flak', clip: 'sfx_fire_flak', tier: 'core', bus: 'weapon', takes: 3, throttleMs: 70, gain: 0.4,
    brief: 'The Flak Cannon, and the ONE per-weapon report in the library. A flatter, harder crack than fire_light - the same rotary mount, a heavier shell. It exists because the two guns on that mount are told apart by ear before they are told apart by eye.',
  },
  {
    id: 'fire_heavy', clip: 'sfx_fire_heavy', tier: 'core', bus: 'weapon', takes: 3, throttleMs: 120, gain: 0.7,
    brief: 'One heavy shell leaving a big tube. Weight and a short tail; this is the sound the whole mech is built around. Cannon, Mortar, Heavy Artillery.',
  },
  {
    id: 'fire_missile', clip: 'sfx_fire_missile', tier: 'core', bus: 'weapon', takes: 3, throttleMs: 90, gain: 0.5,
    brief: 'A rocket motor catching - hiss with a shove behind it, not an explosion. Fires in volleys of two to five, so the takes must layer without phasing. Both missile racks.',
  },
  {
    id: 'fire_energy', clip: 'sfx_fire_energy', tier: 'core', bus: 'weapon', takes: 3, throttleMs: 100, gain: 0.5,
    brief: 'A charged bolt released. Synthetic, pitched, with a slight suck of air before it - the Phase Cannon is the one gun that reads as exotic rather than mechanical.',
  },
  {
    id: 'beam_loop', clip: 'sfx_beam_loop', tier: 'core', bus: 'weapon', takes: 1, throttleMs: 0, gain: 0.4, loop: true,
    brief: 'A continuous beam, started and stopped rather than fired. Must survive being held for seconds and must sit under the hit sounds it causes. One loop serves all three lasers, pitched per beam by the player.',
  },

  // ---- IMPACTS AND BLASTS ---------------------------------------------------------------------
  {
    id: 'hit_kinetic', clip: 'sfx_hit_kinetic', tier: 'core', bus: 'impact', takes: 4, throttleMs: 45, gain: 0.3,
    brief: 'Metal into meat. The default arrival for anything with no element - shells, slugs, missiles. Short and unpitched so it can play under everything.',
  },
  {
    id: 'hit_energy', clip: 'sfx_hit_energy', tier: 'core', bus: 'impact', takes: 3, throttleMs: 45, gain: 0.3,
    brief: 'A beam or bolt landing. Sizzle rather than thud. Every laser tick and the Phase Cannon use this.',
  },
  {
    id: 'blast_small', clip: 'sfx_blast_small', tier: 'core', bus: 'impact', takes: 3, throttleMs: 70, gain: 0.45,
    brief: 'A small burst, roughly a 30-unit blast. Grade one of three: chosen by the shell’s splashRadius, never by which gun threw it.',
  },
  {
    id: 'blast_medium', clip: 'sfx_blast_medium', tier: 'core', bus: 'impact', takes: 3, throttleMs: 80, gain: 0.6,
    brief: 'The middle grade, roughly 60-100 units. Most Phase Cannon and flak bursts land here.',
  },
  {
    id: 'blast_large', clip: 'sfx_blast_large', tier: 'core', bus: 'impact', takes: 2, throttleMs: 120, gain: 0.85,
    brief: 'The artillery and the Mortar. The loudest routine sound in the game; everything else is mixed under this.',
  },

  // ---- THE HORDE -------------------------------------------------------------------------------
  {
    id: 'enemy_die', clip: 'sfx_enemy_die', tier: 'core', bus: 'body', takes: 5, throttleMs: 80, gain: 0.28,
    brief: 'A regular coming apart. Heard more than any other sound in the game by a wide margin - it needs the most takes and the least personality. Anything characterful becomes unbearable by minute three.',
  },
  {
    id: 'enemy_die_elite', clip: 'sfx_enemy_die_elite', tier: 'extended', bus: 'body', takes: 3, throttleMs: 120, gain: 0.5,
    brief: 'An elite or a boss falling. Lower, longer, and worth turning your head for - this is the confirmation that the thing you committed to is actually dead.',
  },
  {
    id: 'boss_spawn', clip: 'sfx_boss_spawn', tier: 'core', bus: 'body', takes: 1, throttleMs: 0, gain: 0.9,
    brief: 'A boss arriving. One of only two sounds allowed to interrupt the mix. Should be audible with the music up and the horde at full volume.',
  },

  // ---- THE MECH ---------------------------------------------------------------------------------
  {
    id: 'player_hurt', clip: 'sfx_player_hurt', tier: 'core', bus: 'body', takes: 3, throttleMs: 150, gain: 0.6,
    brief: 'The mech taking a bite. Must cut through a full horde - being hurt while surrounded is exactly when the player cannot see their own health bar.',
  },
  {
    id: 'player_die', clip: 'sfx_player_die', tier: 'core', bus: 'body', takes: 1, throttleMs: 0, gain: 1,
    brief: 'The run ending. The other sound allowed to interrupt everything. Plays once, ever, per run.',
  },
  {
    id: 'shield_break', clip: 'sfx_shield_break', tier: 'core', bus: 'body', takes: 2, throttleMs: 100, gain: 0.6,
    brief: 'An Energy Shield layer spent. Glassy and clearly SUBTRACTIVE - a player must never confuse it with a pickup.',
  },
  {
    id: 'shield_restore', clip: 'sfx_shield_restore', tier: 'extended', bus: 'body', takes: 2, throttleMs: 100, gain: 0.4,
    brief: 'A layer coming back. The same material as shield_break played the other way round.',
  },

  // ---- WEAPON STATE ------------------------------------------------------------------------------
  {
    id: 'weapon_overheat', clip: 'sfx_weapon_overheat', tier: 'core', bus: 'weapon', takes: 2, throttleMs: 200, gain: 0.55,
    brief: 'A beam cutting out. A FAULT, and it should sound like one - the HUD already hazard-stripes the bar, and this is the half the player hears while looking somewhere else.',
  },
  {
    id: 'weapon_reloaded', clip: 'sfx_weapon_reloaded', tier: 'core', bus: 'weapon', takes: 2, throttleMs: 200, gain: 0.4,
    brief: 'A magazine seated. Fires on RELOAD FINISHED, not on reload started: the fifteen-second silence is the problem, and this is the sound that ends it.',
  },

  // ---- THE REWARD LOOP -----------------------------------------------------------------------------
  {
    id: 'gem_pickup', clip: 'sfx_gem_pickup', tier: 'core', bus: 'pickup', takes: 4, throttleMs: 40, gain: 0.2,
    brief: 'One gem absorbed. Tiny, bright, and quiet - gems arrive in streams of dozens and the magnet collects them in bursts.',
  },
  {
    id: 'consumable_pickup', clip: 'sfx_consumable_pickup', tier: 'core', bus: 'pickup', takes: 2, throttleMs: 120, gain: 0.5,
    brief: 'A spanner, a coin or a magnet taken. Clearly better than a gem - this is a thing the player walked over to get.',
  },
  {
    id: 'barrel_break', clip: 'sfx_barrel_break', tier: 'core', bus: 'world', takes: 3, throttleMs: 90, gain: 0.45,
    brief: 'A fuel drum going. Splintering with a small pop at the end. Also serves a sheep being taken, which needs no sound of its own.',
  },
  {
    id: 'level_up', clip: 'sfx_level_up', tier: 'core', bus: 'pickup', takes: 2, throttleMs: 0, gain: 0.7,
    brief: 'The card coming up. The single most repeated REWARD in the game - twenty-plus times a run - so it must feel good the twentieth time and cannot be a fanfare.',
  },
  {
    id: 'upgrade_taken', clip: 'sfx_upgrade_taken', tier: 'core', bus: 'ui', takes: 2, throttleMs: 0, gain: 0.6,
    brief: 'A card chosen. The commit sound; it answers level_up and must feel like a decision landing.',
  },
  {
    id: 'chest_open', clip: 'sfx_chest_open', tier: 'extended', bus: 'pickup', takes: 1, throttleMs: 0, gain: 0.8,
    brief: 'A Cyber Chest opening. The reel machine has its own tick and fanfare in the UI; this is only the lid.',
  },

  // ---- THE WORLD ------------------------------------------------------------------------------------
  {
    id: 'wall_break', clip: 'sfx_wall_break', tier: 'extended', bus: 'world', takes: 3, throttleMs: 90, gain: 0.4,
    brief: 'A fence section or a tree coming down. Heavier and duller than barrel_break, with no pop.',
  },
  {
    id: 'event_warn', clip: 'sfx_event_warn', tier: 'extended', bus: 'world', takes: 1, throttleMs: 0, gain: 0.7,
    brief: 'A special event firing - a siege ring closing, a swarm crossing. A warning rather than an impact: it says LOOK UP, and the thing it warns about arrives a moment later.',
  },

  // ---- MENUS -----------------------------------------------------------------------------------------
  {
    id: 'ui_move', clip: 'sfx_ui_move', tier: 'core', bus: 'ui', takes: 2, throttleMs: 30, gain: 0.25,
    brief: 'Moving between options. Held direction repeats fast, hence the tight throttle and the low gain.',
  },
  {
    id: 'ui_confirm', clip: 'sfx_ui_confirm', tier: 'core', bus: 'ui', takes: 1, throttleMs: 40, gain: 0.4,
    brief: 'A button pressed. One clip for every accept in the game.',
  },
  {
    id: 'ui_deny', clip: 'sfx_ui_deny', tier: 'core', bus: 'ui', takes: 1, throttleMs: 60, gain: 0.4,
    brief: 'A refusal - a locked chassis, an exclusive weapon, a reroll with none left. Must be unmistakably NOT a confirm.',
  },
] as const) as readonly SfxDef[];

/** By id, built once. The trigger tables resolve through this rather than scanning the array. */
export const SFX_BY_ID: ReadonlyMap<SfxId, SfxDef> = new Map(
  SFX_CATALOG.map((s) => [s.id, s] as const),
);

/** The minimal commission: the sounds without which the game reads as broken rather than quiet. */
export function coreSfx(): readonly SfxDef[] {
  return SFX_CATALOG.filter((s) => s.tier === 'core');
}
