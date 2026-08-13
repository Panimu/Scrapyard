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
 * Seven weapon slots and seven passive slots - the Vampire Survivors shape we are building toward.
 * Four weapons exist today (Cannon + three lasers); the slot count is the target, not the content.
 */
export const MAX_WEAPONS = 7;
export const MAX_PASSIVES = 7;

/**
 * HEAT - the lasers' limiter, in place of a cooldown.
 *
 * A laser fires CONTINUOUSLY and gains heat while it does; at HEAT_MAX it cuts out and cannot fire
 * again until it has cooled to HEAT_RESUME. Cooling runs at the same rate as heating.
 *
 * THE OPENING BURST IS TWICE THE LENGTH OF EVERY LATER ONE, and that is worth understanding
 * before tuning either number. The first burst climbs 0 -> 100; every burst after it starts from
 * HEAT_RESUME and climbs only 50 -> 100. So:
 *
 *              first burst   later bursts   gap      duty (cold)   duty (sustained)
 *   any laser    100/rate       50/rate     50/rate      2/3             1/2
 *
 * A laser therefore opens with a long salvo and then settles into an even on/off rhythm at half
 * uptime. All three share those ratios exactly; what differs is TEMPO - the short laser's cycle
 * is 10 s then 5 s on / 5 s off, the long laser's is 3.3 s then 1.7 s on / 1.7 s off. Same
 * rhythm, very different pulse, which is what makes them read as different guns rather than one
 * gun at three scales.
 */
export const HEAT_MAX = 100;
export const HEAT_RESUME = 50;

/** One beam per weapon per tick, at most. */
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
export const DESPAWN_RADIUS = 900;
/** Equal to DESPAWN_RADIUS, NOT to SPAWN_RADIUS. At 560 the director could not see enemies
 *  trailing behind a kiting player, read the field as empty and spawn more ahead of them - actual
 *  threat ran at double target. Everything alive counts. */
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
