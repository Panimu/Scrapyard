/**
 * ENEMY CONTENT - body classes, flavours and the 48-sprite catalog.
 *
 * WHAT THIS FILE OWNS, AND WHAT IT NO LONGER OWNS. The roster used to be four archetypes mixed by
 * a weighted table, each carrying its own HP and speed. It is now a 120-second CYCLE LADDER
 * (content/cycles.ts): one authored creature per cycle, in three ranks. So:
 *
 *   ARCHETYPE  is a BODY CLASS - radius, mass, contact interval, draw size, and which flavours are
 *              permitted. The PHYSICAL facts of a chassis. NOT the HP bar: that is decided by
 *              RANK alone (content/cycles.ts), because a bar must mean "a rank above you" rather
 *              than "drawn on a wide hull".
 *   TIER       decides the faction recolour   blue -> orange -> green -> grey. PURELY VISUAL, and
 *              now load-bearing: rank is a recolour of the same hull (cycles.ts).
 *   FLAVOUR    per-enemy variation            plain / swift / tough / spiky
 *
 * HP, speed, contact damage and XP come from the cycle ladder x rank, NOT from here. The
 * `hp`/`speed`/`contactDamage`/`xp` fields below survive only as the chassis' reference figures -
 * nothing reads them at runtime.
 *
 * ARCH_ELITE and ARCH_BOSS are vestigial as body classes: elite and boss are RANKS now, and the
 * ladder only uses runt/grunt/bruiser chassis. They stay in the table because ARCHETYPE_COUNT
 * sizes `killsByArchetype` and the difficulty arrays, and renumbering five typed arrays to delete
 * two unused rows buys nothing.
 *
 * ---------------------------------------------------------------------------------------------
 * TWO RULES STILL CONSTRAIN THIS FILE, because the Cannon shoots the HIGHEST-CURRENT-HP enemy:
 *
 *   LAW 1 - HP IS THE AGGRO STAT. Anything high-HP must be worth killing first. That is why every
 *   rank multiplies HP up and speed down: the thing your cannon commits to is always the thing
 *   least able to reach you. `tough` (x1.30 HP) is the one deliberate decoy and is permitted on
 *   runt chassis only.
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

export const ARCH_RUNT = 0;
export const ARCH_GRUNT = 1;
export const ARCH_BRUISER = 2;
export const ARCH_ELITE = 3;
export const ARCH_BOSS = 4;
export type Archetype = 0 | 1 | 2 | 3 | 4;

/** Width of DifficultyState.hpScale / speedScale and RunStats.killsByArchetype. */
export const ARCHETYPE_COUNT = 5;

export const ARCHETYPE_NAMES: readonly string[] = ['runt', 'grunt', 'bruiser', 'elite', 'boss'];

/**
 * ---------------------------------------------------------------------------------------------
 * FLAVOURS THE DIRECTOR CANNOT ROLL
 * ---------------------------------------------------------------------------------------------
 * THREE of them - HEAVY, SWARMER and CHEST DROPPER - and they are unrollable BY ABSENCE. The
 * spawner picks a flavour by drawing from the archetype's own `flavours` list, so a flavour that
 * is on no list can never arrive through the ordinary drip, through an elite drop-in, or through a
 * boss. There is no `spawnable: false` field and no branch in the spawner to forget; the only way
 * any of the three reaches the field is a set-piece that names it (systems/spawning.ts).
 *
 * THIS PARAGRAPH USED TO SIT ON THE HEAVY AND SAY "THE ONE FLAVOUR THE DIRECTOR CANNOT ROLL". It
 * was true when it was written and stopped being true the moment the Swarmer landed, and then
 * again for the chest dropper - and nothing complained, because a claim about a set is exactly the
 * kind of comment that rots when the set grows. It is stated once here, and `enemyCatalog.test.ts`
 * pins the membership, so the next flavour that joins fails a test instead of quietly making a
 * paragraph wrong.
 */
export const FLAV_PLAIN = 0;
export const FLAV_SWIFT = 1;
export const FLAV_TOUGH = 2;
export const FLAV_SPIKY = 3;
/**
 * HEAVY - a SET-PIECE-ONLY flavour. See "flavours the director cannot roll", above.
 *
 * x10 HP at x0.0871 speed is a wall that walks. Both halves matter: ten times the hit points would
 * be a wandering roadblock, and an eleventh of the speed alone would be a free kill. Together
 * they are a thing you must either grind down or go around, and it will still be there when you
 * come back.
 *
 * THE SPEED HAS NOW GONE UP A FIFTH TWICE - 0.0605, then 0.0726, now 0.0871. In absolute terms a
 * Heavy walks at 4.1 to 9.0 u/s depending on which archetype the cycle is spending (it was 3.4 to
 * 7.5, and 2.8 to 6.2 before that). The complaint each time was the same one, which is why the
 * number moved twice: the back of a siege ring took long enough to close that a player could simply
 * leave, deal with something else and come back to find it barely moved. Every figure below that is
 * measured in "seconds of its walking" is a fifth shorter again, and they are updated rather than
 * left to rot - a derived number in a comment is worth nothing the moment the thing it was derived
 * from moves.
 *
 * AND IT TAKES A QUARTER OF THE KNOCKBACK. A body this slow is one you fight by pushing, and a
 * Cannon shell throwing it as far as it walks in fourteen seconds turned the wall into something
 * you could sweep aside for free. Half was not enough - at 190 impulse on a 0.5-mass body that was
 * still 95 u/s, seventeen seconds of its walking per shell. A quarter still moves it visibly; it is
 * not the Scraplord's outright immunity. It just stops one shell being worth more than the whole
 * approach.
 *
 * AND IT HAS FOUR TIMES THE LEASH. Every body that falls more than RELOCATE_RADIUS behind you is
 * picked up and re-dealt in front of you; that rule dissolves formations rather than moving them,
 * so at 1000 u a ring you stepped away from came back as fifty unrelated bodies a few seconds
 * later. At 4000 u the ring survives being LEFT - walk off, deal with something else, come back,
 * and it is still standing where it closed - while a player who genuinely crosses the yard still
 * brings it with them rather than towing an abandoned set-piece behind them all run.
 */
export const FLAV_HEAVY = 4;

/**
 * SWARMER - the Heavy's opposite, and unspawnable for the same reason: it is on no archetype's
 * `flavours` list, so the drip, the elite drop-in and the boss cannot produce one. Nothing places
 * it yet; a set-piece that names it will be what puts it on the field.
 *
 * DOUBLE SPEED AT 60% HP. The Heavy is a thing you go around; this is a thing you cannot outrun
 * and do not have to shoot twice. Against a hero cruising 1.08x above the fastest regular (see
 * Invariant K in cycles.ts), a x2 flavour is the first body in the game that closes on a KITING
 * player rather than merely following them - which is exactly why it is off the ordinary spawn
 * tables and belongs in a set-piece with a shape and an end.
 *
 * THE SMALLEST CHASSIS USED TO BE CALLED `swarmer` AND IS NOW `runt`, renamed to make room for
 * this. That is the right way round: a chassis is a body plan and a flavour is what a body does,
 * and "swarms you" describes behaviour far better than it describes a silhouette. Runt sits
 * beside grunt and bruiser, which is the register those names were always in.
 *
 * The tint was checked against the actual sprites rather than guessed at, and it is honest about
 * what it can do: a multiply cannot ADD yellow, only take blue away. On the grey-hulled bodies
 * (#99a3a3) it lands as khaki, #999871 - clearly warm at a glance. On the blue-panelled ones
 * (#1ea7e1) there is no red to keep, so it goes teal rather than yellow. Red is left at 100% so
 * the body warms instead of dimming, which is the opposite of the Heavy's cool, darker lean.
 */
export const FLAV_SWARMER = 5;

/**
 * CHEST DROPPER - the third unspawnable flavour, and the first one that is a REWARD rather than a
 * threat. On no archetype's `flavours` list, so the drip cannot produce one; the CHEST ELITE
 * event is what puts it on the field, always at elite rank (systems/spawning.ts).
 *
 * THREE TIMES THE HIT POINTS AT 105% SPEED, ON TOP OF AN ELITE'S OWN MULTIPLIERS. An elite is
 * already five times a regular, so this is a body with fifteen times a regular's hit points that
 * walks slightly faster than the elite it is otherwise identical to. The speed is the interesting
 * half: an elite is "a place on the map" precisely because the rank ladder trades speed away for
 * bulk, and 1.05 is just enough to stop this one being a stationary target you shoot at leisure -
 * it follows, slowly, while you deal with everything else it walked in with.
 *
 * HALF THE XP. It is a chest that has to be shot, and the chest IS the payment. Paying an elite's
 * full XP on top would make the event a level as well as a chest, and the two rewards would
 * compound into the one set-piece a player waits for rather than one they are pleased to see.
 *
 * `dropsChest` is what actually pays. See systems/pickups.ts - it rides the kill feed, the same
 * route a boss's chest takes, so it survives the body being reaped in the tick that killed it.
 *
 * The tint is the warm gold the chest itself wears, which is the only warning a player gets and
 * the only one they need: this is the body worth chasing.
 */
export const FLAV_CHEST_DROPPER = 6;
export type Flavour = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface FlavourDef {
  readonly id: Flavour;
  readonly name: string;
  readonly hp: number;
  readonly speed: number;
  readonly dmg: number;
  /**
   * XP multiplier. 1 for everything the director can roll, and it has to be: a variant that paid
   * differently would make the ordinary drip's XP depend on which flavours a seed happened to
   * produce, and the levelling curve is tuned against the cycle ladder rather than against luck.
   *
   * It exists for the set-piece bodies, which are paid for what they ARE rather than what they
   * cost to kill - see `chest dropper`, which pays half because the chest is the payment.
   */
  readonly xp: number;
  /**
   * Leaves a Cyber Chest where it died. FALSE FOR EVERYTHING ELSE, and the flag lives here rather
   * than as a branch in the drop code for the usual reason: a second body that pays a chest should
   * be a literal in this table, not a second condition somewhere in pickups.ts.
   */
  readonly dropsChest: boolean;
  /** Render hint. `tough` is visibly bigger, which is how Law 1 stays legible to the player. */
  readonly renderScale: number;
  /** Render hint. `spiky` gets a red additive rim - the only cue for a stat the turret ignores. */
  readonly renderGlow: boolean;
  /**
   * Render hint. Multiplied into the body sprite, so 0xffffff is "leave the art alone" and every
   * flavour but `heavy` uses it.
   *
   * A TINT AND NOT A GLOW, for the Heavy specifically. The additive rim `spiky` uses says "this
   * one bites harder" and is meant to catch the eye in a crowd; a Heavy is not a warning, it is a
   * different KIND of object, and the honest way to say that is to change what it is made of
   * rather than to put a light on it.
   *
   * A TINT IS A MULTIPLY, WHICH CANNOT DESATURATE - it can only take light away, per channel. So
   * the grey is bought by taking MORE red than blue: the paint goes cooler and dimmer while the
   * silhouette and its shading survive intact. Checked against the actual sprites rather than
   * guessed at, on the rust floor they are seen on, at three candidate strengths.
   */
  readonly renderTint: number;
  /**
   * WHAT FRACTION OF AN IMPULSE THIS BODY ACTUALLY TAKES. 1 is "shoved like anything else".
   *
   * SEPARATE FROM MASS ON PURPOSE. Knockback is impulse/mass and so is the crowd's separation
   * push, so doubling a flavour's mass to halve its knockback would also make it shove every
   * other body twice as hard - a change to how the horde flows, bought by accident while buying
   * a change to how shells land. This multiplier touches only what weapons do to the body.
   */
  readonly knockback: number;
  /**
   * Multiplier on RELOCATE_RADIUS - how far behind the player this body may fall before it is
   * picked up and put back in front of them.
   *
   * 1 for everything the director spawns, because the relocation rule is what makes the yard feel
   * endless and a wave that could simply be walked away from is not a wave.
   *
   * A SET-PIECE WANTS A MUCH LONGER LEASH, AND STILL WANTS ONE. Relocation does not move a
   * formation, it DISSOLVES one - each straggler is re-dealt independently at a fresh ring
   * position - so at the ordinary 1000 u a ring you stepped away from came back as fifty unrelated
   * bodies scattered around you a few seconds later. It has to survive being LEFT: walk off, deal
   * with something else, come back, and the ring is still standing where it closed.
   *
   * But exempting it outright was the other extreme, and wrong for a different reason - a player
   * who genuinely crosses the yard should not tow an abandoned set-piece behind them for the rest
   * of the run, parked forever in a corner they will never revisit while it eats the live-enemy
   * budget the horde is drawn from. So the Heavy's leash is FOUR TIMES the horde's: 4000 u, about
   * twenty seconds of sustained running, which no kiting circle reaches and no deliberate journey
   * across the yard misses.
   */
  readonly relocate: number;
}

export const FLAVOURS: readonly FlavourDef[] = Object.freeze([
  Object.freeze({ id: FLAV_PLAIN, name: 'plain', hp: 1, speed: 1, dmg: 1, xp: 1, dropsChest: false, renderScale: 1, renderGlow: false, renderTint: 0xffffff, knockback: 1, relocate: 1 }),
  Object.freeze({ id: FLAV_SWIFT, name: 'swift', hp: 0.85, speed: 1.18, dmg: 0.9, xp: 1, dropsChest: false, renderScale: 0.92, renderGlow: false, renderTint: 0xffffff, knockback: 1, relocate: 1 }),
  Object.freeze({ id: FLAV_TOUGH, name: 'tough', hp: 1.3, speed: 0.88, dmg: 1, xp: 1, dropsChest: false, renderScale: 1.18, renderGlow: false, renderTint: 0xffffff, knockback: 1, relocate: 1 }),
  Object.freeze({ id: FLAV_SPIKY, name: 'spiky', hp: 0.95, speed: 1, dmg: 1.35, xp: 1, dropsChest: false, renderScale: 1, renderGlow: true, renderTint: 0xffffff, knockback: 1, relocate: 1 }),
  // `renderScale` is a RENDER HINT and does not move the hitbox - the same compromise `tough`
  // already makes at 1.18. Kept to 1.3 for that reason: a Heavy has to read as a different object
  // at a glance, and every unit past that is a unit of lie between the sprite and the circle.
  // 0xa8b2bd: red down to 66%, blue only to 74%, so the lean is cool rather than merely dark.
  // SLIGHT is the brief - an orange hauler goes grey-brown and is still obviously an orange
  // hauler. A neutral grey of the same weight only dimmed it, and pushing further (0x9aa8b8)
  // stopped reading as a tinge and started reading as a different paint job.
  Object.freeze({ id: FLAV_HEAVY, name: 'heavy', hp: 10, speed: 0.08712, dmg: 1, xp: 1, dropsChest: false, renderScale: 1.3, renderGlow: false, renderTint: 0xa8b2bd, knockback: 0.25, relocate: 4 }),
  // Contact damage, size and knockback are all left at the plain body's: the brief is speed and
  // fragility, and every extra dial turned here is one more thing to explain when it arrives.
  Object.freeze({ id: FLAV_SWARMER, name: 'swarmer', hp: 0.6, speed: 2, dmg: 1, xp: 1, dropsChest: false, renderScale: 1, renderGlow: false, renderTint: 0xffeeb0, knockback: 1, relocate: 1 }),
  // Contact damage and knockback are left alone deliberately: this is an elite that pays out, not
  // an elite that hits differently, and the player should recognise it by its colour rather than
  // have to learn a second bite. `renderScale` is left at 1 for the same reason - the rank already
  // makes it big, and the gold is the signal.
  Object.freeze({ id: FLAV_CHEST_DROPPER, name: 'chest dropper', hp: 3, speed: 1.05, dmg: 1, xp: 0.5, dropsChest: true, renderScale: 1, renderGlow: false, renderTint: 0xf0b429, knockback: 1, relocate: 1 }),
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
  /** Seconds between contact ticks from THIS enemy. Per-enemy, not global i-frames: one runt
   *  must not be able to soak the player's invulnerability on behalf of a bruiser. */
  readonly contactInterval: number;
  readonly radius: number;
  /** Doubles as knockback resistance and crowding weight - which is what makes bruisers act as
   *  moving walls that part the chaff around them. */
  readonly mass: number;
  readonly xp: number;
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
    id: ARCH_RUNT as Archetype,
    name: 'runt',
    hp: 20,
    speed: 103,
    contactDamage: 5,
    contactInterval: 0.6,
    radius: 13,
    mass: 0.5,
    xp: 1,
    // NO `swift` - Invariant K. A swift runt outruns BULWARK by t=900.
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
 * (runt 320-379, grunt 1004-1206, bruiser 1362-1532, elite 1624-1740 - non-overlapping
 * bands). It is NOT the naive `01..16 / 17..32 / 33..48` split, which would have made hull 1 -
 * a 16x24 px infantry sprite - a bruiser, so the game would have shown the player a foot
 * soldier and asked them to believe it had 185 HP. "Bigger sprite = bigger enemy" holds exactly.
 *
 * hull:        1  2  3  4  5  6  7  8  9 10 11 12
 * reads as:   inf inf inf inf inf truck truck truck TANK BUS RIG inf
 */
const HULL_ARCHETYPE: readonly Archetype[] = [
  ARCH_RUNT, // 1  infantry, plain          338 px
  ARCH_RUNT, // 2  infantry, helmet         338 px
  ARCH_RUNT, // 3  infantry, arms out       379 px
  ARCH_RUNT, // 4  infantry, shoulder pads  372 px
  ARCH_RUNT, // 5  infantry, bulky          320 px
  ARCH_GRUNT, //   6  light truck             1004 px
  ARCH_BRUISER, // 7  long truck              1362 px
  ARCH_GRUNT, //   8  boxy truck              1206 px
  ARCH_ELITE, //   9  tank, gun barrel        1624 px
  ARCH_ELITE, //  10  heavy hover-bus         1740 px
  ARCH_BRUISER, //11  rig with cylinder       1532 px
  ARCH_RUNT, //12  infantry, orange         320 px
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
