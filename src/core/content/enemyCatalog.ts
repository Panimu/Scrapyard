/**
 * ENEMY CONTENT - body classes, flavours and the 48-sprite catalog.
 *
 * WHAT THIS FILE OWNS, AND WHAT IT NO LONGER OWNS. The roster used to be four archetypes mixed by
 * a weighted table, each carrying its own HP and speed. It is now a 120-second CYCLE LADDER
 * (content/cycles.ts): one authored creature per cycle, in three ranks. So:
 *
 *   ARCHETYPE  is a BODY CLASS - radius, mass, contact interval, HP-bar policy, draw size, and
 *              which flavours are permitted. The PHYSICAL facts of a chassis.
 *   TIER       decides the faction recolour   blue -> orange -> green -> grey. PURELY VISUAL, and
 *              now load-bearing: rank is a recolour of the same hull (cycles.ts).
 *   FLAVOUR    per-enemy variation            plain / swift / tough / spiky
 *
 * HP, speed, contact damage and XP come from the cycle ladder x rank, NOT from here. The
 * `hp`/`speed`/`contactDamage`/`xp` fields below survive only as the chassis' reference figures -
 * nothing reads them at runtime.
 *
 * ARCH_ELITE and ARCH_BOSS are vestigial as body classes: elite and boss are RANKS now, and the
 * ladder only uses swarmer/grunt/bruiser chassis. They stay in the table because ARCHETYPE_COUNT
 * sizes `killsByArchetype` and the difficulty arrays, and renumbering five typed arrays to delete
 * two unused rows buys nothing.
 *
 * ---------------------------------------------------------------------------------------------
 * TWO RULES STILL CONSTRAIN THIS FILE, because the Cannon shoots the HIGHEST-CURRENT-HP enemy:
 *
 *   LAW 1 - HP IS THE AGGRO STAT. Anything high-HP must be worth killing first. That is why every
 *   rank multiplies HP up and speed down: the thing your cannon commits to is always the thing
 *   least able to reach you. `tough` (x1.30 HP) is the one deliberate decoy and is permitted on
 *   swarmer chassis only.
 *
 *   INVARIANT K - KITING. Every hero must stay at least 1.08x faster than the fastest enemy at
 *   every t. `swift` is therefore FORBIDDEN ON SWARMER CHASSIS, which are the fastest bodies on
 *   the ladder. See `maxEnemySpeedAt` in cycles.ts.
 *
 * (Law 2 - non-overlapping HP bands - is now satisfied by construction rather than by tuning: a
 * cycle's regular, elite and boss sit at 1x / 5x / 14x, which cannot overlap.)
 *
 * `spiky` (x1.35 contact damage, NO HP change) is the sharpest tool here precisely because it is
 * invisible to the targeting rule: more dangerous without becoming higher priority.
 * ---------------------------------------------------------------------------------------------
 */

// -----------------------------------------------------------------------------------------
// Archetypes
// -----------------------------------------------------------------------------------------

export const ARCH_SWARMER = 0;
export const ARCH_GRUNT = 1;
export const ARCH_BRUISER = 2;
export const ARCH_ELITE = 3;
export const ARCH_BOSS = 4;
export type Archetype = 0 | 1 | 2 | 3 | 4;

/** Width of DifficultyState.hpScale / speedScale and RunStats.killsByArchetype. */
export const ARCHETYPE_COUNT = 5;

export const ARCHETYPE_NAMES: readonly string[] = ['swarmer', 'grunt', 'bruiser', 'elite', 'boss'];

export const FLAV_PLAIN = 0;
export const FLAV_SWIFT = 1;
export const FLAV_TOUGH = 2;
export const FLAV_SPIKY = 3;
export type Flavour = 0 | 1 | 2 | 3;

export interface FlavourDef {
  readonly id: Flavour;
  readonly name: string;
  readonly hp: number;
  readonly speed: number;
  readonly dmg: number;
  /** Render hint. `tough` is visibly bigger, which is how Law 1 stays legible to the player. */
  readonly renderScale: number;
  /** Render hint. `spiky` gets a red additive rim - the only cue for a stat the turret ignores. */
  readonly renderGlow: boolean;
}

export const FLAVOURS: readonly FlavourDef[] = Object.freeze([
  Object.freeze({ id: FLAV_PLAIN, name: 'plain', hp: 1, speed: 1, dmg: 1, renderScale: 1, renderGlow: false }),
  Object.freeze({ id: FLAV_SWIFT, name: 'swift', hp: 0.85, speed: 1.18, dmg: 0.9, renderScale: 0.92, renderGlow: false }),
  Object.freeze({ id: FLAV_TOUGH, name: 'tough', hp: 1.3, speed: 0.88, dmg: 1, renderScale: 1.18, renderGlow: false }),
  Object.freeze({ id: FLAV_SPIKY, name: 'spiky', hp: 0.95, speed: 1, dmg: 1.35, renderScale: 1, renderGlow: true }),
] as const) as readonly FlavourDef[];

export interface ArchetypeDef {
  readonly id: Archetype;
  readonly name: string;
  /**
   * REFERENCE FIGURES ONLY - the shipping spawner reads none of these. They are what this chassis
   * "means" (and what test fixtures are built from); live HP, speed, contact damage and XP come
   * from CYCLE_LADDER x RANKS in content/cycles.ts.
   */
  readonly hp: number;
  readonly speed: number;
  readonly contactDamage: number;
  /** Seconds between contact ticks from THIS enemy. Per-enemy, not global i-frames: one swarmer
   *  must not be able to soak the player's invulnerability on behalf of a bruiser. */
  readonly contactInterval: number;
  readonly radius: number;
  /** Doubles as knockback resistance and crowding weight - which is what makes bruisers act as
   *  moving walls that part the chaff around them. */
  readonly mass: number;
  readonly xp: number;
  readonly showHpBar: boolean;
  /**
   * Permitted flavours. INDEX 0 IS ALWAYS `FLAV_PLAIN` - the spawner relies on it (it rolls
   * "plain or not", then picks uniformly from indices 1..n-1).
   */
  readonly flavours: readonly Flavour[];
  /** World units across, for the renderer. Matches the sprite band it draws from. */
  readonly drawSize: number;
}

/**
 * DESIGN.md §8.3. Base values at runSec = 0, before flavour and before growth.
 *
 * Read the columns as a shape, not a list: HP multiplies ~2.9x per band while speed DIVIDES,
 * so the thing the cannon wants to shoot is always the thing least able to reach you. That is
 * what makes an elite "a place on the map" rather than a pursuer - and it has to be, because
 * your cannon commits to it whether you like it or not.
 */
export const ARCHETYPES: readonly ArchetypeDef[] = Object.freeze([
  Object.freeze({
    id: ARCH_SWARMER as Archetype,
    name: 'swarmer',
    hp: 20,
    speed: 103,
    contactDamage: 5,
    contactInterval: 0.6,
    radius: 13,
    mass: 0.5,
    xp: 1,
    showHpBar: false,
    // NO `swift` - Invariant K. A swift swarmer outruns BULWARK by t=900.
    flavours: Object.freeze([FLAV_PLAIN, FLAV_TOUGH, FLAV_SPIKY]) as readonly Flavour[],
    drawSize: 26,
  }),
  Object.freeze({
    id: ARCH_GRUNT as Archetype,
    name: 'grunt',
    hp: 58,
    speed: 78,
    contactDamage: 9,
    contactInterval: 0.6,
    radius: 18,
    mass: 1.2,
    xp: 3,
    showHpBar: false,
    // `swift` is safe here: 98 x 1.18 x growth peaks at 124.6 u/s, well under every hero.
    flavours: Object.freeze([FLAV_PLAIN, FLAV_SWIFT, FLAV_SPIKY]) as readonly Flavour[],
    drawSize: 34,
  }),
  Object.freeze({
    id: ARCH_BRUISER as Archetype,
    name: 'bruiser',
    hp: 185,
    speed: 60,
    contactDamage: 17,
    contactInterval: 0.7,
    radius: 26,
    mass: 3,
    xp: 9,
    showHpBar: true,
    // NO `tough` - Law 1. A 1.30x bruiser is a 700 HP decoy that eats the whole run's output.
    flavours: Object.freeze([FLAV_PLAIN, FLAV_SPIKY]) as readonly Flavour[],
    drawSize: 42,
  }),
  Object.freeze({
    id: ARCH_ELITE as Archetype,
    name: 'elite',
    hp: 407,
    speed: 51,
    contactDamage: 28,
    contactInterval: 0.8,
    radius: 34,
    mass: 7,
    xp: 45,
    showHpBar: true,
    // PLAIN ONLY. An elite is already the top target for ~11 s; flavour on top of that is noise.
    flavours: Object.freeze([FLAV_PLAIN]) as readonly Flavour[],
    drawSize: 52,
  }),
  Object.freeze({
    id: ARCH_BOSS as Archetype,
    name: 'Scraplord',
    hp: 4000,
    speed: 47,
    contactDamage: 45,
    contactInterval: 0.9,
    radius: 56,
    // Not Infinity: `Infinity * 0` is NaN, and a NaN in pushX would poison the pool's hash
    // forever. 1e9 is exactly representable in float32 and makes 1/mass a hard zero in practice.
    mass: 1e9,
    xp: 500,
    showHpBar: true,
    flavours: Object.freeze([FLAV_PLAIN]) as readonly Flavour[],
    drawSize: 112,
  }),
] as const) as readonly ArchetypeDef[];

// MAX_ENEMY_RADIUS lives in content/cycles.ts: the widest body the LADDER can spawn, at boss
// size. It is a fact about the cycle table, not about this one - the vestigial ARCH_ELITE and
// ARCH_BOSS chassis are wider still and never spawn, and paying their radius on every spatial
// query would cost frames for enemies that do not exist.

// -----------------------------------------------------------------------------------------
// The 48 sprites
// -----------------------------------------------------------------------------------------

export interface EnemyDef {
  /** 0..47, always equal to the index. */
  readonly id: number;
  /** Atlas frame key, `enemy_01`..`enemy_48`. */
  readonly sprite: string;
  readonly archetype: Archetype;
  /** 1..12. Silhouette identity: hull N, N+12, N+24, N+36 are pixel-identical recolours. */
  readonly hull: number;
  /** 0..3 - blue / orange / green / grey. Purely visual. */
  readonly tier: 0 | 1 | 2 | 3;
  /** World units across. Mirrors the archetype so the renderer needs no second table. */
  readonly drawSize: number;
}

/**
 * Hull -> archetype, indexed by hull-1. THIS IS THE ONLY PLACE THE MAPPING IS DECIDED.
 *
 * Taken from ASSET_MANIFEST.md §2, which grouped the hulls by MEASURED OPAQUE PIXEL AREA
 * (swarmer 320-379, grunt 1004-1206, bruiser 1362-1532, elite 1624-1740 - non-overlapping
 * bands). It is NOT the naive `01..16 / 17..32 / 33..48` split, which would have made hull 1 -
 * a 16x24 px infantry sprite - a bruiser, so the game would have shown the player a foot
 * soldier and asked them to believe it had 185 HP. "Bigger sprite = bigger enemy" holds exactly.
 *
 * hull:        1  2  3  4  5  6  7  8  9 10 11 12
 * reads as:   inf inf inf inf inf truck truck truck TANK BUS RIG inf
 */
const HULL_ARCHETYPE: readonly Archetype[] = [
  ARCH_SWARMER, // 1  infantry, plain          338 px
  ARCH_SWARMER, // 2  infantry, helmet         338 px
  ARCH_SWARMER, // 3  infantry, arms out       379 px
  ARCH_SWARMER, // 4  infantry, shoulder pads  372 px
  ARCH_SWARMER, // 5  infantry, bulky          320 px
  ARCH_GRUNT, //   6  light truck             1004 px
  ARCH_BRUISER, // 7  long truck              1362 px
  ARCH_GRUNT, //   8  boxy truck              1206 px
  ARCH_ELITE, //   9  tank, gun barrel        1624 px
  ARCH_ELITE, //  10  heavy hover-bus         1740 px
  ARCH_BRUISER, //11  rig with cylinder       1532 px
  ARCH_SWARMER, //12  infantry, orange         320 px
] as Archetype[];

/** The Scraplord reuses `enemy_46` (hull 10, grey) at 112 u - the only sprite reuse in the game. */
export const BOSS_TYPE_ID = 45;

/**
 * Exactly 48 entries, carrying NO STATS. Stats come from archetype x flavour x growth, so this
 * stays a pure sprite/identity table and a retune never touches 48 rows.
 *
 * Generated from HULL_ARCHETYPE rather than typed out: `id -> (hull, tier)` is arithmetic, and
 * 48 hand-written rows would drift from the manifest the first time anyone edited one.
 * tests/spawning.test.ts re-checks the result against the manifest's literal file lists, so the
 * generation is verified against the source of truth rather than against itself.
 */
export const ENEMY_CATALOG: readonly EnemyDef[] = (() => {
  const out: EnemyDef[] = [];
  for (let id = 0; id < 48; id++) {
    const hull = (id % 12) + 1;
    const tier = ((id / 12) | 0) as 0 | 1 | 2 | 3;
    const archetype = HULL_ARCHETYPE[hull - 1];
    const n = id + 1;
    out.push(
      Object.freeze({
        id,
        sprite: `enemy_${n < 10 ? '0' : ''}${n}`,
        archetype,
        hull,
        tier,
        drawSize: ARCHETYPES[archetype].drawSize,
      }),
    );
  }
  return Object.freeze(out) as readonly EnemyDef[];
})();

/**
 * [archetype][tier] -> the typeIds a spawn of that archetype may use in that tier band.
 *
 * Precomputed at module load so the spawner picks a sprite with one `nextInt` and one typed-array
 * load - no scanning, no allocation, no per-tick catalog walk. Row counts are 6/2/2/2, which is
 * the manifest's 24/8/8/8 divided by four tiers.
 */
export const ENEMY_IDS_BY_ARCHETYPE_TIER: readonly (readonly Uint8Array[])[] = (() => {
  const counts: number[][] = [];
  for (let a = 0; a < ARCHETYPE_COUNT; a++) counts.push([0, 0, 0, 0]);
  for (const def of ENEMY_CATALOG) counts[def.archetype][def.tier]++;

  const rows: Uint8Array[][] = [];
  for (let a = 0; a < ARCHETYPE_COUNT; a++) {
    rows.push([
      new Uint8Array(counts[a][0]),
      new Uint8Array(counts[a][1]),
      new Uint8Array(counts[a][2]),
      new Uint8Array(counts[a][3]),
    ]);
  }
  const cursor: number[][] = [];
  for (let a = 0; a < ARCHETYPE_COUNT; a++) cursor.push([0, 0, 0, 0]);
  for (const def of ENEMY_CATALOG) {
    rows[def.archetype][def.tier][cursor[def.archetype][def.tier]++] = def.id;
  }
  return rows;
})();
