/**
 * Simulation constants. Everything here is part of the determinism key: changing a value
 * changes every replay and every golden hash.
 *
 * Device-dependent numbers are deliberately absent. The sim never learns the viewport size
 * (DESIGN.md §0 #16) - the camera is clamped instead, so rotating the phone buys no sight-line.
 */

/** Fixed simulation rate. One stepWorld() call is exactly this long. Never variable. */
export const TICK_RATE = 60;
export const DT = 1 / 60;
export const DT_MS = 1000 / 60;

// ---------------------------------------------------------------------------------------------
// Pool capacities. Fixed at createWorld, never grown. Sized so allocation cannot fail in a
// well-behaved run and, when it does, fails loudly at the director rather than silently.
// ---------------------------------------------------------------------------------------------
export const ENEMY_CAP = 512;
export const PROJECTILE_CAP = 256;
export const PICKUP_CAP = 512;

/** Director hard caps, kept below the pool caps so allocation can never silently fail. */
export const MAX_LIVE_ENEMIES = 300;
export const GEM_SOFT_CAP = 400;

// ---------------------------------------------------------------------------------------------
// Per-tick scratch sizes. All preallocated; nothing here grows.
// ---------------------------------------------------------------------------------------------
export const MAX_HITS_PER_TICK = 512;
export const MAX_CONTACTS_PER_TICK = 128;
export const MAX_KILLS_PER_TICK = 128;
export const MAX_QUERY_CANDIDATES = 2048;
/** Power of two - the ring masks rather than divides. */
export const EVENT_RING_CAPACITY = 1024;

/**
 * FIVE weapon slots and five passive slots.
 *
 * Eight weapons exist and only five can be carried, which makes a run a CHOICE rather than a
 * collection: by the fifth gun the pool stops offering new ones and every later card deepens what
 * you already hold. Two runs on the same mech can end up genuinely different builds.
 *
 * SIX passives exist against those five slots, for the same reason, and it bites hardest on the
 * two defensive ones: Ablative Plate and Energy Shield cover opposite halves of the same problem
 * (see the shield card in data/upgrades.ts), and taking both costs 40% of the passive budget.
 *
 * `isOfferable` enforces both caps independently - it gates the UNLOCK on the cap while continuing
 * to offer tiers for anything already held, so hitting five weapons narrows the pool instead of
 * ending progression.
 */
export const MAX_WEAPONS = 5;
export const MAX_PASSIVES = 5;

/**
 * HEAT - the lasers' limiter, in place of a cooldown.
 *
 * A laser fires CONTINUOUSLY and gains heat while it does; at its CAPACITY it cuts out and cannot
 * fire again until it has cooled to HEAT_RESUME_FRAC of that capacity.
 *
 * Capacity, generation and dispersion are all PER-WEAPON STATS, not constants, because the tier
 * ladder upgrades them independently: a tier raises damage AND heat generation together (a real
 * tradeoff), later tiers buy capacity (longer bursts) or dispersion (shorter silences). Splitting
 * generation from dispersion is what makes those three different upgrades rather than one.
 *
 * THE OPENING BURST IS LONGER THAN EVERY LATER ONE. The first climbs from cold (0 -> capacity);
 * every later one restarts at the resume threshold. At the default half-capacity resume that makes
 * the opening burst exactly twice the length of the rest, and sustained uptime
 * dispersion / (generation + dispersion) - which is 1/2 only while the two rates are equal, and
 * rises as dispersion tiers are taken.
 */
export const HEAT_RESUME_FRAC = 0.5;

/** Default capacity, and the value every weapon's `heatCapacity` base starts from. */
export const HEAT_CAPACITY_BASE = 100;

export const MAX_BEAMS_PER_TICK = MAX_WEAPONS;
export const UPGRADE_OFFER_COUNT = 3;
/** Length of World.scratch.targets: the largest top-K any fire pattern may request. */
export const MAX_TARGETS = 8;
/** Length of PlayerState.traitScratch. Slot meanings are documented per trait in data/traits.ts. */
export const TRAIT_SCRATCH_LEN = 8;
/** Length of WeaponInstance.scratch (burst counters, per-weapon trait counters). */
export const WEAPON_SCRATCH_LEN = 4;

// ---------------------------------------------------------------------------------------------
// World geometry. Sim constants, deliberately independent of the device (DESIGN.md §8.7):
// the largest half-diagonal any supported viewport can show is 500.9 u, against SPAWN_RADIUS 560,
// so enemies always appear off-screen without the sim knowing anything about the screen.
// ---------------------------------------------------------------------------------------------
export const SPAWN_RADIUS = 560;

/**
 * THE ARENA IS A TORUS OF THIS SIZE, in world units, square. Walk off one edge and you come back
 * on the other; there are no walls and there is nowhere that is not the arena.
 *
 * 4096 is chosen against three numbers, not picked for feel:
 *
 *   > 2 x THREAT_RADIUS (1800). This is the binding one. The director spawns to hold PRESSURE
 *     within 900 u of the player, so if the far side of the world were inside that radius it
 *     would count the entire population as "near me", throttle itself to the cycle's target and
 *     stop advancing the ladder. At 4096 the far side is 2048 u away - genuinely elsewhere.
 *   > 4 x SPAWN_RADIUS (2240), so a spawn ring never overlaps itself around the back.
 *   = 64 spatial cells at SPATIAL_CELL_SIZE 64, which keeps the broad phase's cell coordinates
 *     small and tidy for anything that later wants to reason about them.
 *
 * A lap is 4096 / 195 = 21 seconds at a mech's top speed. That is the number that decides how the
 * world FEELS: long enough that running away is a real escape, short enough that it is only ever
 * a loop, and you meet what you left behind.
 */
export const ARENA_SIZE = 4096;
/** Half-extent. The furthest anything can ever be from anything else, per axis. */
export const ARENA_HALF = ARENA_SIZE / 2;

/**
 * ARTILLERY STRIKE ANNULUS - where a barrage is allowed to land.
 *
 * A long radius about the player, deliberately NOT tied to what is on screen. Trying to define
 * "visible" made the simulation care about the viewport, which the camera rule forbids (iOS cannot
 * lock orientation, so screen shape must never change what the game does). A fixed long radius
 * sidesteps that entirely and gives the weapon a different job: it reaches past the fight you are
 * in and onto the ground enemies are still crossing, out toward the SPAWN_RADIUS ring at 560.
 *
 * The inner bound keeps a barrage off your own feet - artillery that could land on the player
 * would be a self-centred nuke rather than area denial.
 *
 * 70-320 is a deliberate middle. Area grows with the SQUARE of the radius, so the annulus is a
 * density dial as much as a reach one: at 210 the barrage was concentrated and reliable but sat on
 * top of the melee; at 520 it reached the spawn ring and dealt a sixth of the damage, with four
 * fifths of it landing where no screen could show it. At 320 most shells are still on screen on a
 * typical device, it reaches past the bodies actually touching you, and it keeps roughly half the
 * concentration of the tight version.
 */
export const STRIKE_RADIUS_MIN = 70;
export const STRIKE_RADIUS_MAX = 320;
/**
 * How far the director can SEE. Enemies beyond it do not count toward local pressure.
 *
 * It used to double as the despawn radius - outrun something by 900 u and it was deleted. Nothing
 * despawns any more (the arena wraps, so there is no "away" to outrun something to), and the two
 * numbers have gone their separate ways: this one is now purely the director's field of view.
 *
 * NOT SPAWN_RADIUS. At 560 the director could not see enemies trailing behind a kiting player,
 * read the field as empty and spawned more ahead of them - actual threat ran at double target.
 * Everything alive and nearby counts.
 */
export const THREAT_RADIUS = 900;

/**
 * Broad-phase grid. 64 u against enemy radii of 13-34 u is ~2.4 enemies per occupied cell at
 * the endgame density of ~120 live. Both are constructor arguments to createSpatialHash so the
 * harness can sweep them without touching this file.
 */
export const SPATIAL_CELL_SIZE = 64;
/** Power of two - buckets are masked, not modulo'd. */
export const SPATIAL_BUCKET_COUNT = 4096;

/** Seconds of playable calm before the director starts. runSec stays 0 throughout. */
export const INTRO_SEC = 3;
/** The Scraplord walks in at 15:00. */
export const RUN_LENGTH_SEC = 900;
