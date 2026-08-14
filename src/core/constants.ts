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
/**
 * 768, not 512, and the extra room is REQUIRED rather than generous.
 *
 * At the gem soft cap the drop path RETIRES a gem and allocates a new one in the same breath, and
 * a retire is a deferred mark-dead - S12 is the only place a slot is actually freed. So a tick that
 * lands MAX_KILLS_PER_TICK kills while saturated grows the pool by that many before the reaper
 * runs: 500 + 128 = 628 in the worst case. 512 would have failed the allocation and silently sent
 * the XP down the fallback path.
 */
export const PICKUP_CAP = 768;

/** Director hard caps, kept below the pool caps so allocation can never silently fail. */
export const MAX_LIVE_ENEMIES = 300;
/**
 * How many pickups may lie on the ground before the drop path starts RETIRING the oldest gem to
 * make room. See `dropGems`.
 *
 * 500, up from 400, and the reason 400 was wrong is worth writing down: a gem only leaves the pool
 * when it is COLLECTED, and nobody collects them all. The reference bot picks up 58% of what it
 * drops and a player who kites picks up about 25%, so live gems climb by roughly one per second of
 * survival for the whole run - monotonically, with nothing to drain them.
 *
 * At 400 that meant saturation around 6 minutes for a kiting player and 13 for the bot, and
 * saturation used to mean NO KILL PRODUCED A GEM EVER AGAIN. Raising the number buys time; the
 * retire-oldest rule is what actually fixes it.
 */
export const GEM_SOFT_CAP = 500;

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

/**
 * How many bodies one CHAIN LASER beam may cross, counting the first.
 *
 * The real limiter is the range budget - each jump spends the distance it covers, and the chain
 * stops when the next nearest body will not fit in what is left - so this is a backstop against
 * a pathological crowd standing shoulder to shoulder, not a balance number. It also bounds the
 * beam buffer, which is why the two constants are written next to each other.
 */
export const MAX_CHAIN_LINKS = 10;

/**
 * One entry per DRAWN SEGMENT, not per weapon. A chaining beam pushes one segment per jump, so a
 * full-length chain from every laser slot at once is the worst case - which is what this is.
 */
export const MAX_BEAMS_PER_TICK = MAX_WEAPONS * MAX_CHAIN_LINKS;
export const UPGRADE_OFFER_COUNT = 3;

/**
 * CONSOLATION OFFERS - what a level-up card or a Cyber Chest hands over once the run has taken
 * every upgrade it can.
 *
 * They are NEGATIVE SENTINELS rather than catalog entries, and that is the whole design. A real
 * card would need a weight, a tier ladder, an icon in the deck and a rule keeping it out of every
 * ordinary draw; a sentinel needs one branch at the point of application. Nothing else in the
 * game can produce a negative offer - every real one is a catalog index - so the two spaces
 * cannot collide.
 *
 * WHY THEY EXIST AT ALL. The pool is 14 cards x 7 tiers and a long run genuinely empties it. The
 * old behaviour was to open NO card and silently drop the pending level-ups, which is correct and
 * safe and reads exactly like the game breaking: you level up and nothing happens. A weak heal or
 * a handful of credits is not a reward, it is an acknowledgement.
 */
export const OFFER_HEAL = -2;
export const OFFER_CREDITS = -3;
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
 * A fuel barrel further than this from the mech CANNOT BE BROKEN, by anything.
 *
 * ---------------------------------------------------------------------------------------------
 * IT IS A CHEAT, AND IT IS ON THE PLAYER'S SIDE
 * ---------------------------------------------------------------------------------------------
 * A barrel broken off screen is worse than a barrel not broken: the drum is spent, and whatever
 * fell out of it lands somewhere the player never saw and never collects. Several things reach
 * well past the edge of the picture - a Long Laser with Targeting Optics is a 710 u beam, the
 * artillery lands on ground the player is not looking at, and a missile rack fires wherever the
 * mech last ran - so a run quietly burns drums it never gets paid for. This stops that.
 *
 * ---------------------------------------------------------------------------------------------
 * WHY IT IS A CONSTANT AND NOT THE ACTUAL VIEWPORT
 * ---------------------------------------------------------------------------------------------
 * This is the whole reason the number is here rather than being asked of the camera. Core is the
 * determinism boundary: if what breaks depended on the SHAPE OF THE PHONE, a wide screen and a
 * tall one would consume different barrels, drop different consumables, and diverge - and a run
 * recorded on a phone would not replay in Node, which has no viewport at all.
 *
 * So it is one fixed radius, derived once from the view box rather than from a device: the short
 * axis shows VIEW_MINOR_UNITS (440) and the long axis is capped at VIEW_MAJOR_MAX_UNITS (900) and
 * letterboxed past that, so the furthest visible point on ANY supported viewport is the corner at
 * sqrt(220^2 + 450^2) = 500.9 u.
 *
 * 512 sits just outside that. The error is deliberately biased: too LOW and the game refuses to
 * break a drum the player can plainly see, which reads as broken; too HIGH and a few genuinely
 * unseen barrels still go up, which is only the old behaviour in a smaller radius. So "off screen"
 * here means DEFINITELY off screen - a barrel 480 u out to the side is not on screen either, and
 * it can still be broken. Tightening to the 220 u that is visible in every orientation would
 * refuse most of what the player is actually aiming at.
 */
export const BARREL_BREAK_RADIUS = 512;

/**
 * THE ARENA IS A FENCED SQUARE OF THIS SIZE, in world units. A real barrier, not a wrap: the
 * scrapyard has a perimeter fence, you can walk up to it, and you cannot walk through it.
 *
 * ---------------------------------------------------------------------------------------------
 * WHY THIS IS NOT A TORUS ANY MORE
 * ---------------------------------------------------------------------------------------------
 * It briefly was, at 4096, and the torus was the wrong model twice over. It is not what the genre
 * does - Vampire Survivors' stages are bounded rectangles, and what it moves is ENEMIES (anything
 * too far behind is relocated ahead of you) while GEMS stay exactly where they fell. And a 21 s lap
 * meant the world had no elsewhere: every gem you abandoned came back to you, which is the reward
 * for going back to fetch it deleted.
 *
 * So the geometry is now honest - a big walled yard, with the two rules that make it feel endless
 * living where they belong: RELOCATE_RADIUS moves the horde, and nothing at all moves the gems.
 *
 * ---------------------------------------------------------------------------------------------
 * WHY 12288
 * ---------------------------------------------------------------------------------------------
 * 63 seconds to cross at a mech's 195 u/s top speed, against a 900 s run. That is the number that
 * decides how the world feels, and it is chosen to sit between two failures:
 *
 *   TOO SMALL and the fence is a cage. At the old 4096 a committed sprint hits a wall in 21 s -
 *     several times per run, in the middle of fights, with the horde arriving behind you.
 *   TOO LARGE and the fence is a lie: it exists in the constants and no player ever sees it. The
 *     barrier is meant to be REAL, which means reachable.
 *
 * At 12288 a player who commits to one direction meets the fence about once a run, which is
 * exactly often enough that the yard has edges and rarely enough that it never has walls.
 *
 * It is also 192 SPATIAL_CELL_SIZE cells across. That costs nothing - the broad phase hashes cell
 * coordinates into SPATIAL_BUCKET_COUNT buckets rather than indexing a dense grid, so the arena
 * could be any size at all without the hash growing by a byte.
 */
export const ARENA_SIZE = 12288;
/**
 * Half-extent, measured to the INNER FACE of the fence. This is the playable bound: no entity's
 * CENTRE may pass it, and each is held its own radius short of it.
 */
export const ARENA_HALF = ARENA_SIZE / 2;

/**
 * How deep the fence itself is, drawn OUTWARD from ARENA_HALF. Simulation-side only so the sim and
 * the renderer agree on where the barrier is; nothing collides with the band itself.
 *
 * 56 u is about 13% of the 440 u minor view, so walking up to it fills a real slice of the screen
 * and reads as a structure rather than a hairline.
 */
export const FENCE_DEPTH = 56;

/**
 * HOW FAR BEHIND AN ENEMY MAY FALL before it is picked up and put back on the spawn ring.
 *
 * This is the rule that makes a bounded yard behave like an endless one, and it is Vampire
 * Survivors' rule rather than a torus: outrun something and it is not deleted and does not come
 * around the back - it reappears on the ring ahead of you, at the SAME HP, rank and cycle. A horde
 * you ran away from is a horde you still have to kill.
 *
 * IT IS PINNED JUST OUTSIDE THREAT_RADIUS (900), AND THAT IS THE WHOLE CHOICE. The gap between the
 * two is a DEAD BAND: an enemy in it has stopped counting toward local pressure, so the director
 * will not spawn to replace it, and it has not yet been relocated, so it will not come back either.
 * Every unit of that band is population quietly leaking out of the fight.
 *
 * The first draft put this at 1400 and the band was 500 u wide, which measured as a visibly emptier
 * yard: at 3:29 the reference run held 20 live enemies against the previous build's 53, and 129
 * kills by 9:29 against 369. The bot then arrived at the late cycles six levels under-geared and
 * died to them. It also meant relocation essentially never fired for a player who ORBITS rather
 * than sprints, which is most play - the rule was there and did nothing.
 *
 * At 1000 the band is 100 u, about half a second of walking, and the four reference seeds land
 * within one minute of each other instead of spread across seven. Consistency is the tell: field
 * density has stopped depending on how far the player happened to wander.
 *
 * Still comfortably off screen - 1000 against a 500.9 u max half-diagonal - so nothing is ever seen
 * to jump.
 *
 * IT DOES NOT APPLY TO BOSSES. A boss is a tenant, not a wave (systems/spawning.ts), and outrunning
 * one has always been possible and always cost you - it is still walking toward you, still alive,
 * and still suppressing six regulars' worth of spawning when it catches up. Relocating bosses would
 * make a cycle's set-piece inescapable, which is a difficulty change dressed up as a geometry one.
 */
export const RELOCATE_RADIUS = 1000;

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
 * despawns any more (outrun it far enough and it is RELOCATED ahead of you instead, see
 * RELOCATE_RADIUS), and the two numbers have gone their separate ways: this one is now purely the
 * director's field of view.
 *
 * The gap between the two is deliberate and is where kiting still pays. Past 900 u an enemy stops
 * counting toward local pressure, so the director spawns more; past 1400 u it is put back in front
 * of you. Running therefore buys you a 500 u band of relief and then hands the bill back.
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

/**
 * THE CYBER CHEST - the slot machine a dead boss leaves behind.
 *
 * Three reels, and a spin pays between one and five power-ups. Both numbers are simulation facts
 * rather than presentation ones: the sim decides where the reels land and how many upgrades that
 * is worth, and the overlay animates toward a result it was handed. A slot machine whose outcome
 * were decided by the animation would be a slot machine that could not be replayed.
 */
export const CHEST_REELS = 3;
export const CHEST_MAX_PAYOUT = 5;

/** Seconds of playable calm before the director starts. runSec stays 0 throughout. */
export const INTRO_SEC = 3;
/**
 * The clock the run is measured against - 16:00, which is exactly the eight authored cycles at
 * 120 s each. Reaching it is NECESSARY but not SUFFICIENT: `checkVictory` also requires an empty
 * yard, so the last cycle's Scraplord (in at 15:30) is the finale rather than something the
 * clock can expire out from under.
 */
export const RUN_LENGTH_SEC = 960;
