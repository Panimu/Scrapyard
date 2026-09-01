/**
 * THE SOUND LIBRARY - what noises this game is allowed to make, and nothing about when.
 *
 * ---------------------------------------------------------------------------------------------
 * FORTY-EIGHT CLIPS, ONE PER LINE, AND THE FILES EXIST
 * ---------------------------------------------------------------------------------------------
 * Every `clip` here resolves to `public/sfx/<clip>.mp3`. They were commissioned from the brief in
 * `sfx/sfx-set.js`, four takes each, chosen in `sfx/picker.html` and conditioned into place by
 * `sfx/publish.mjs` - mono, trimmed, peak-normalised to -1 dBFS. That last step is why the `gain`
 * column below still means something: the files share headroom rather than loudness, so the
 * relative numbers here are the mix rather than a suggestion the mastering already flattened.
 *
 * `tests/sfx.test.ts` pins the pairing. Every id must have a file and every file must have an id,
 * so a clip deleted from disk is a failing test rather than a hole nobody hears until a player
 * does.
 *
 * ---------------------------------------------------------------------------------------------
 * FIRING IS PER-WEAPON NOW, AND THAT IS A REVERSAL
 * ---------------------------------------------------------------------------------------------
 * The previous library covered fourteen guns with five firing classes, on the rule that no sound
 * may serve one weapon. It was a good rule and it cost too much: the Mortar and the Cannon became
 * the same event, and the guns are what a player hears most of all. So the per-item spend goes
 * here, and the saving is taken everywhere else instead - three impacts by damage type, three
 * graded blasts, one death per rank.
 *
 * ---------------------------------------------------------------------------------------------
 * THIS IS RENDER-LAYER DATA AND MUST STAY THERE
 * ---------------------------------------------------------------------------------------------
 * `src/core/` is a deterministic simulation that does not know what a speaker is, and sound must
 * never influence it. Core already says what happened through the event ring; this layer listens.
 * Nothing here is in the world hash, and a muted run and a loud one are the same run.
 */

export type SfxId =
  | 'fire_cannon'
  | 'fire_mg'
  | 'fire_flak'
  | 'fire_mortar'
  | 'fire_artillery'
  | 'fire_missile_s'
  | 'fire_missile_l'
  | 'fire_laser_s'
  | 'fire_laser_m'
  | 'fire_laser_l'
  | 'fire_phase'
  | 'fire_plasma'
  | 'fire_sludge'
  | 'fire_drone'
  | 'hit_bullet'
  | 'hit_laser'
  | 'hit_plasma'
  | 'blast_small'
  | 'blast_medium'
  | 'blast_large'
  | 'splat_acid'
  | 'pick_gem'
  | 'pick_credit'
  | 'pick_repair'
  | 'pick_magnet'
  | 'pick_dice'
  | 'pick_sheep'
  | 'level_up'
  | 'card_taken'
  | 'chest_open'
  | 'ascend'
  | 'achievement'
  | 'die_grunt'
  | 'die_elite'
  | 'player_hurt'
  | 'shield_break'
  | 'boss_warn'
  | 'die_boss'
  | 'event_swarm'
  | 'run_lost'
  | 'run_won'
  | 'barrel_break'
  | 'wall_break'
  | 'reload'
  | 'overheat'
  | 'ui_move'
  | 'ui_confirm'
  | 'ui_deny';

export type SfxBus = 'weapon' | 'impact' | 'body' | 'pickup' | 'ui' | 'world';

export interface SfxDef {
  readonly id: SfxId;
  /** Resolves to `public/sfx/<clip>.mp3`. Equal to the id today, and kept separate so a file can
   *  be swapped without a rename rippling through every trigger that names the sound. */
  readonly clip: string;
  /** Which mixer group it belongs to. One volume per bus, never one per clip. */
  readonly bus: SfxBus;
  /**
   * THE FLOOR BETWEEN TWO PLAYS OF THIS SOUND, in milliseconds, and the column a horde game cannot
   * skip: forty runts dying in a tick is forty `die_grunt` requests, and playing all of them is
   * not loud, it is WHITE NOISE. Per-sound because the right answer differs by two orders of
   * magnitude between a machine gun round and a boss arriving. 0 means "cannot double up".
   */
  readonly throttleMs: number;
  /** Baseline gain, 0..1, before the bus fader. A gem must never be as loud as a boss. */
  readonly gain: number;
  /** True for the three beams, which run until told to stop rather than firing once. */
  readonly loop?: boolean;
  /** What it is for, in the words the brief used. */
  readonly brief: string;
}

/** THE LIBRARY, in the order the brief lays it out. */
export const SFX_CATALOG: readonly SfxDef[] = Object.freeze([

  // -------------------------------------------------------------------------------------------
  // Weapons firing - one per gun
  // -------------------------------------------------------------------------------------------
  {
    id: 'fire_cannon', clip: 'fire_cannon', bus: 'weapon', throttleMs: 110, gain: 0.55,
    brief: 'One heavy shell, about one a second',
  },
  {
    id: 'fire_mg', clip: 'fire_mg', bus: 'weapon', throttleMs: 60, gain: 0.3,
    brief: 'A two-round burst, 11 times a second',
  },
  {
    id: 'fire_flak', clip: 'fire_flak', bus: 'weapon', throttleMs: 70, gain: 0.4,
    brief: 'Four shells into a wide cone',
  },
  {
    id: 'fire_mortar', clip: 'fire_mortar', bus: 'weapon', throttleMs: 140, gain: 0.55,
    brief: 'One shell lobbed high, every two seconds',
  },
  {
    id: 'fire_artillery', clip: 'fire_artillery', bus: 'weapon', throttleMs: 200, gain: 0.7,
    brief: 'Two shells called down from off-map',
  },
  {
    id: 'fire_missile_s', clip: 'fire_missile_s', bus: 'weapon', throttleMs: 90, gain: 0.45,
    brief: 'Two tubes, every three seconds',
  },
  {
    id: 'fire_missile_l', clip: 'fire_missile_l', bus: 'weapon', throttleMs: 120, gain: 0.5,
    brief: 'Five tubes, every four seconds',
  },
  {
    id: 'fire_laser_s', clip: 'fire_laser_s', bus: 'weapon', throttleMs: 0, gain: 0.3, loop: true,
    brief: 'A continuous beam - seamless loop',
  },
  {
    id: 'fire_laser_m', clip: 'fire_laser_m', bus: 'weapon', throttleMs: 0, gain: 0.34, loop: true,
    brief: 'A continuous beam - seamless loop',
  },
  {
    id: 'fire_laser_l', clip: 'fire_laser_l', bus: 'weapon', throttleMs: 0, gain: 0.38, loop: true,
    brief: 'A continuous beam - seamless loop',
  },
  {
    id: 'fire_phase', clip: 'fire_phase', bus: 'weapon', throttleMs: 100, gain: 0.5,
    brief: 'A slow energy bolt, every 1.6s',
  },
  {
    id: 'fire_plasma', clip: 'fire_plasma', bus: 'weapon', throttleMs: 70, gain: 0.3,
    brief: 'A stream of bolts, four a second',
  },
  {
    id: 'fire_sludge', clip: 'fire_sludge', bus: 'weapon', throttleMs: 100, gain: 0.42,
    brief: 'A lobbed canister, every 1.5s',
  },
  {
    id: 'fire_drone', clip: 'fire_drone', bus: 'weapon', throttleMs: 120, gain: 0.22,
    brief: 'A drone released from the bay',
  },

  // -------------------------------------------------------------------------------------------
  // Hits, by damage type
  // -------------------------------------------------------------------------------------------
  {
    id: 'hit_bullet', clip: 'hit_bullet', bus: 'impact', throttleMs: 45, gain: 0.28,
    brief: 'Cannon, machine gun, flak, on a body',
  },
  {
    id: 'hit_laser', clip: 'hit_laser', bus: 'impact', throttleMs: 45, gain: 0.26,
    brief: 'Any beam, and the Phase Cannon',
  },
  {
    id: 'hit_plasma', clip: 'hit_plasma', bus: 'impact', throttleMs: 50, gain: 0.28,
    brief: 'Plasma bolts, and anything that sets a burn',
  },

  // -------------------------------------------------------------------------------------------
  // Explosions, graded by blast radius
  // -------------------------------------------------------------------------------------------
  {
    id: 'blast_small', clip: 'blast_small', bus: 'impact', throttleMs: 70, gain: 0.45,
    brief: 'Flak shells, short missiles, a drone dying',
  },
  {
    id: 'blast_medium', clip: 'blast_medium', bus: 'impact', throttleMs: 80, gain: 0.6,
    brief: 'Phase Cannon, mortar shells',
  },
  {
    id: 'blast_large', clip: 'blast_large', bus: 'impact', throttleMs: 120, gain: 0.85,
    brief: 'Artillery, long missiles',
  },
  {
    id: 'splat_acid', clip: 'splat_acid', bus: 'impact', throttleMs: 90, gain: 0.4,
    brief: 'A sludge canister bursting into a puddle',
  },

  // -------------------------------------------------------------------------------------------
  // Pickups and progression
  // -------------------------------------------------------------------------------------------
  {
    id: 'pick_gem', clip: 'pick_gem', bus: 'pickup', throttleMs: 40, gain: 0.18,
    brief: 'Every gem collected - the most frequent sound in the game',
  },
  {
    id: 'pick_credit', clip: 'pick_credit', bus: 'pickup', throttleMs: 70, gain: 0.28,
    brief: 'A blue coin walked over',
  },
  {
    id: 'pick_repair', clip: 'pick_repair', bus: 'pickup', throttleMs: 120, gain: 0.45,
    brief: 'A repair pickup, hull restored',
  },
  {
    id: 'pick_magnet', clip: 'pick_magnet', bus: 'pickup', throttleMs: 150, gain: 0.5,
    brief: 'The magnet powerup starting its sweep',
  },
  {
    id: 'pick_dice', clip: 'pick_dice', bus: 'pickup', throttleMs: 150, gain: 0.45,
    brief: 'The reroll die, once a run',
  },
  {
    id: 'pick_sheep', clip: 'pick_sheep', bus: 'pickup', throttleMs: 120, gain: 0.4,
    brief: 'Mossy Mayhem’s loot prop, caught',
  },
  {
    id: 'level_up', clip: 'level_up', bus: 'pickup', throttleMs: 0, gain: 0.65,
    brief: 'A level gained, the card about to open',
  },
  {
    id: 'card_taken', clip: 'card_taken', bus: 'ui', throttleMs: 0, gain: 0.55,
    brief: 'A card chosen from the level-up screen',
  },
  {
    id: 'chest_open', clip: 'chest_open', bus: 'pickup', throttleMs: 0, gain: 0.75,
    brief: 'A chest opening - the run stops for it',
  },
  {
    id: 'ascend', clip: 'ascend', bus: 'pickup', throttleMs: 0, gain: 0.8,
    brief: 'A weapon reaching tier 8 - the one secret in the game',
  },
  {
    id: 'achievement', clip: 'achievement', bus: 'ui', throttleMs: 0, gain: 0.55,
    brief: 'An achievement unlocking, over whatever is happening',
  },

  // -------------------------------------------------------------------------------------------
  // Bodies
  // -------------------------------------------------------------------------------------------
  {
    id: 'die_grunt', clip: 'die_grunt', bus: 'body', throttleMs: 80, gain: 0.26,
    brief: 'Any regular enemy dying - plays constantly',
  },
  {
    id: 'die_elite', clip: 'die_elite', bus: 'body', throttleMs: 120, gain: 0.45,
    brief: 'An elite dying',
  },
  {
    id: 'player_hurt', clip: 'player_hurt', bus: 'body', throttleMs: 150, gain: 0.6,
    brief: 'The mech taking damage',
  },
  {
    id: 'shield_break', clip: 'shield_break', bus: 'body', throttleMs: 100, gain: 0.55,
    brief: 'An energy shield rim going down',
  },

  // -------------------------------------------------------------------------------------------
  // Bosses and set pieces
  // -------------------------------------------------------------------------------------------
  {
    id: 'boss_warn', clip: 'boss_warn', bus: 'body', throttleMs: 0, gain: 0.85,
    brief: 'The cycle boss walking in',
  },
  {
    id: 'die_boss', clip: 'die_boss', bus: 'body', throttleMs: 0, gain: 0.85,
    brief: 'A boss going down',
  },
  {
    id: 'event_swarm', clip: 'event_swarm', bus: 'world', throttleMs: 0, gain: 0.6,
    brief: 'The swarm set-piece starting',
  },

  // -------------------------------------------------------------------------------------------
  // Run outcomes
  // -------------------------------------------------------------------------------------------
  {
    id: 'run_lost', clip: 'run_lost', bus: 'body', throttleMs: 0, gain: 1,
    brief: 'The run ending in failure',
  },
  {
    id: 'run_won', clip: 'run_won', bus: 'body', throttleMs: 0, gain: 1,
    brief: 'Surviving the clock with every boss down',
  },

  // -------------------------------------------------------------------------------------------
  // World and interface
  // -------------------------------------------------------------------------------------------
  {
    id: 'barrel_break', clip: 'barrel_break', bus: 'world', throttleMs: 90, gain: 0.42,
    brief: 'A drum shot open',
  },
  {
    id: 'wall_break', clip: 'wall_break', bus: 'world', throttleMs: 90, gain: 0.38,
    brief: 'A tree felled, a site fence opened',
  },
  {
    id: 'reload', clip: 'reload', bus: 'weapon', throttleMs: 200, gain: 0.38,
    brief: 'A magazine weapon coming back online',
  },
  {
    id: 'overheat', clip: 'overheat', bus: 'weapon', throttleMs: 200, gain: 0.5,
    brief: 'A beam weapon cutting out',
  },
  {
    id: 'ui_move', clip: 'ui_move', bus: 'ui', throttleMs: 30, gain: 0.22,
    brief: 'Cursor moving between options',
  },
  {
    id: 'ui_confirm', clip: 'ui_confirm', bus: 'ui', throttleMs: 40, gain: 0.38,
    brief: 'An option chosen',
  },
  {
    id: 'ui_deny', clip: 'ui_deny', bus: 'ui', throttleMs: 60, gain: 0.38,
    brief: 'Something unaffordable or locked',
  },
]);

export const SFX_BY_ID: ReadonlyMap<SfxId, SfxDef> = new Map(
  SFX_CATALOG.map((d) => [d.id, d]),
);

/** The three beams. Everything else is fire-and-forget. */
export const SFX_LOOPS: readonly SfxId[] = Object.freeze(
  SFX_CATALOG.filter((d) => d.loop === true).map((d) => d.id),
);
