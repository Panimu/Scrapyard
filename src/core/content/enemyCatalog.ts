/**
 * ENEMY CONTENT - archetypes, flavours and the 48-sprite catalog.
 *
 * THREE ORTHOGONAL AXES (DESIGN.md §5.4). Keeping them separate is what lets late-game enemies
 * read as "veterans" without a stat table per sprite:
 *
 *   ARCHETYPE  decides every stat            swarmer / grunt / bruiser / elite / boss
 *   TIER       decides the faction recolour  blue -> orange -> green -> grey. PURELY VISUAL.
 *   FLAVOUR    per-enemy variation           plain / swift / tough / spiky
 *
 * The mechanical ramp is neither of the last two: it is `updateDifficulty`'s per-second growth.
 *
 * ---------------------------------------------------------------------------------------------
 * WHY THE NUMBERS ARE WHAT THEY ARE: the Cannon shoots the HIGHEST-CURRENT-HP enemy in range.
 * That single rule constrains this entire file (DESIGN.md §7.4):
 *
 *   LAW 1 - HP IS THE AGGRO STAT. Anything high-HP must be worth killing first. `tough` (x1.30
 *   HP) is the one deliberate decoy, and it is permitted ON SWARMERS ONLY - on a bruiser it
 *   would be a 700 HP tarpit that hijacks the player's entire output for no reason.
 *
 *   LAW 2 - ARCHETYPE HP BANDS MUST NEVER OVERLAP, AT ANY t. If they overlap, the highest-HP
 *   target flips as enemies take damage, the turret thrashes, and the weapon reads as broken.
 *   Formally minHP(band n+1, t) >= 1.85 x maxHP(band n, t) for all t in [60, 900], ranging over
 *   each archetype's PERMITTED flavours. Verified minimum is 1.92x (swarmer->grunt at t=60);
 *   see tests/spawning.test.ts, which re-derives it rather than trusting this comment.
 *
 *   INVARIANT K - KITING. Every hero must stay at least 1.08x faster than the fastest enemy at
 *   every t. `swift` is therefore FORBIDDEN ON SWARMERS: a swift swarmer at t=900 would run at
 *   170 u/s against a 163.8 u/s BULWARK, and the genre stops working.
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
  /** The director's currency. Spawning stops while local threat >= target, so one elite (14)
   *  suppresses fourteen swarmers' worth of pressure while it lives. */
  readonly threat: number;
  readonly showHpBar: boolean;
  /**
   * Growth per WHOLE SECOND, applied by repeated multiplication at second boundaries.
   * `Math.pow` is banned in core (implementation-defined), so the per-second root is a
   * precomputed literal and `updateDifficulty` multiplies 900 times over a run: exact IEEE ops,
   * drift ~1e-13, bit-identical on V8 and JSC.
   */
  readonly hpGrowthPerSec: number;
  readonly speedGrowthPerSec: number;
  /** Documentation and test target only - NEVER evaluated at runtime. */
  readonly hpGrowthPerMin: number;
  readonly speedGrowthPerMin: number;
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
    speed: 132,
    contactDamage: 5,
    contactInterval: 0.6,
    radius: 13,
    mass: 0.5,
    xp: 1,
    threat: 1,
    showHpBar: false,
    // Deliberately the SLOWEST HP growth in the roster: a swarmer must never drift up into the
    // grunt band, or the cannon would start wasting 1.2 s shells on 40 HP chaff.
    hpGrowthPerSec: 1.00073388,
    speedGrowthPerSec: 1.0000997,
    hpGrowthPerMin: 1.045,
    speedGrowthPerMin: 1.006,
    // NO `swift` - Invariant K. A swift swarmer outruns BULWARK by t=900.
    flavours: Object.freeze([FLAV_PLAIN, FLAV_TOUGH, FLAV_SPIKY]) as readonly Flavour[],
    drawSize: 26,
  }),
  Object.freeze({
    id: ARCH_GRUNT as Archetype,
    name: 'grunt',
    hp: 58,
    speed: 98,
    contactDamage: 9,
    contactInterval: 0.6,
    radius: 18,
    mass: 1.2,
    xp: 3,
    threat: 2,
    showHpBar: false,
    hpGrowthPerSec: 1.00097162,
    speedGrowthPerSec: 1.00008313,
    hpGrowthPerMin: 1.06,
    speedGrowthPerMin: 1.005,
    // `swift` is safe here: 98 x 1.18 x growth peaks at 124.6 u/s, well under every hero.
    flavours: Object.freeze([FLAV_PLAIN, FLAV_SWIFT, FLAV_SPIKY]) as readonly Flavour[],
    drawSize: 34,
  }),
  Object.freeze({
    id: ARCH_BRUISER as Archetype,
    name: 'bruiser',
    hp: 185,
    speed: 76,
    contactDamage: 17,
    contactInterval: 0.7,
    radius: 26,
    mass: 3,
    xp: 9,
    threat: 5,
    showHpBar: true,
    hpGrowthPerSec: 1.00120607,
    speedGrowthPerSec: 1.00006654,
    hpGrowthPerMin: 1.075,
    speedGrowthPerMin: 1.004,
    // NO `tough` - Law 1. A 1.30x bruiser is a 700 HP decoy that eats the whole run's output.
    flavours: Object.freeze([FLAV_PLAIN, FLAV_SPIKY]) as readonly Flavour[],
    drawSize: 42,
  }),
  Object.freeze({
    id: ARCH_ELITE as Archetype,
    name: 'elite',
    hp: 407,
    speed: 64,
    contactDamage: 28,
    contactInterval: 0.8,
    radius: 34,
    mass: 7,
    xp: 45,
    threat: 14,
    showHpBar: true,
    hpGrowthPerSec: 1.00136059,
    speedGrowthPerSec: 1.00004993,
    hpGrowthPerMin: 1.085,
    speedGrowthPerMin: 1.003,
    // PLAIN ONLY. An elite is already the top target for ~11 s; flavour on top of that is noise.
    flavours: Object.freeze([FLAV_PLAIN]) as readonly Flavour[],
    drawSize: 52,
  }),
  Object.freeze({
    id: ARCH_BOSS as Archetype,
    name: 'Scraplord',
    hp: 4000,
    speed: 58,
    contactDamage: 45,
    contactInterval: 0.9,
    radius: 56,
    // Not Infinity: `Infinity * 0` is NaN, and a NaN in pushX would poison the pool's hash
    // forever. 1e9 is exactly representable in float32 and makes 1/mass a hard zero in practice.
    mass: 1e9,
    xp: 500,
    // Zero: the boss is not an ordinary spawn-pressure source. While it lives the director
    // targets `bossTargetMul` (0.6) of the normal curve instead, which is a clearer lever.
    threat: 0,
    showHpBar: true,
    // No growth: 4000 is 2.89x the t=900 elite, unambiguously the top target for its entire life.
    hpGrowthPerSec: 1,
    speedGrowthPerSec: 1,
    hpGrowthPerMin: 1,
    speedGrowthPerMin: 1,
    flavours: Object.freeze([FLAV_PLAIN]) as readonly Flavour[],
    drawSize: 112,
  }),
] as const) as readonly ArchetypeDef[];

/** Hot-loop lookup for the director's per-tick threat scan. Avoids an object deref per enemy. */
export const THREAT_BY_ARCHETYPE: Float64Array = (() => {
  const a = new Float64Array(ARCHETYPE_COUNT);
  for (let i = 0; i < ARCHETYPES.length; i++) a[i] = ARCHETYPES[i].threat;
  return a;
})();

/** Largest radius in the roster (the boss). Sizes the separation query - see enemyAI.ts. */
export const MAX_ENEMY_RADIUS: number = (() => {
  let m = 0;
  for (let i = 0; i < ARCHETYPES.length; i++) if (ARCHETYPES[i].radius > m) m = ARCHETYPES[i].radius;
  return m;
})();

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

/**
 * Probability that a spawn rolls a NON-plain flavour, by visual tier.
 *
 * Rising with tier is what makes the faction recolour mean something without touching the stat
 * bands: a grey-band swarmer is more likely to be a `tough` decoy or a `spiky` biter than a blue
 * one, so "veterans" is a claim the player can actually observe. Safe by construction - Law 2
 * and Invariant K are verified over EVERY permitted flavour regardless of how often it rolls,
 * so this dial can move freely during playtest. FEEL.
 */
export const VARIANT_CHANCE_BY_TIER: readonly number[] = [0.1, 0.18, 0.26, 0.34];

// -----------------------------------------------------------------------------------------
// Derived helpers.
//
// Used by tests, the harness and the design docs - NOT by the tick. They recompute growth the
// same way updateDifficulty does (repeated multiplication over whole seconds) rather than with
// `pow`, so a test comparing them to live simulation state compares like with like, to the ulp.
// -----------------------------------------------------------------------------------------

export function hpScaleAt(archetype: Archetype, runSec: number): number {
  const steps = Math.floor(runSec);
  const g = ARCHETYPES[archetype].hpGrowthPerSec;
  let v = 1;
  for (let i = 0; i < steps; i++) v *= g;
  return v;
}

export function speedScaleAt(archetype: Archetype, runSec: number): number {
  const steps = Math.floor(runSec);
  const g = ARCHETYPES[archetype].speedGrowthPerSec;
  let v = 1;
  for (let i = 0; i < steps; i++) v *= g;
  return v;
}

/** Lowest HP this archetype can spawn with at `runSec`, over its permitted flavours (Law 2). */
export function archetypeMinHpAt(archetype: Archetype, runSec: number): number {
  const a = ARCHETYPES[archetype];
  const s = hpScaleAt(archetype, runSec);
  let m = Infinity;
  for (const f of a.flavours) {
    const v = a.hp * FLAVOURS[f].hp * s;
    if (v < m) m = v;
  }
  return m;
}

/** Highest HP this archetype can spawn with at `runSec`, over its permitted flavours (Law 2). */
export function archetypeMaxHpAt(archetype: Archetype, runSec: number): number {
  const a = ARCHETYPES[archetype];
  const s = hpScaleAt(archetype, runSec);
  let m = 0;
  for (const f of a.flavours) {
    const v = a.hp * FLAVOURS[f].hp * s;
    if (v > m) m = v;
  }
  return m;
}

/**
 * Fastest steering speed any spawnable enemy can have at `runSec`.
 *
 * THE number Invariant K is tested against. Excludes the boss, which is slower than everything
 * and anchored anyway. Peaks at 144.391 u/s (a plain swarmer at t=900).
 */
export function maxEnemySpeedAt(runSec: number): number {
  let m = 0;
  for (let a = 0; a < ARCHETYPES.length; a++) {
    if (a === ARCH_BOSS) continue;
    const def = ARCHETYPES[a];
    const s = speedScaleAt(a as Archetype, runSec);
    for (const f of def.flavours) {
      const v = def.speed * FLAVOURS[f].speed * s;
      if (v > m) m = v;
    }
  }
  return m;
}
