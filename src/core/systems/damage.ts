/**
 * S9 - updateDamage. APPLICATION. The only stage in the simulation that changes an hp number.
 *
 * It consumes the two buffers S8 filled, in buffer order, and produces:
 *   - enemy hp changes, knockback, splash;
 *   - the KillFeed, which S10 turns into gems THIS SAME TICK;
 *   - player hp changes, and the transition to RUN_PHASE_DEAD;
 *   - Energy Shield layers spent, and the immunity window a break opens;
 *   - RunStats and the event ring for the renderer.
 *
 * `dt` is part of the mandated system signature and is deliberately unused: everything here is a
 * discrete event with no rate of its own. The two per-tick rates that could have lived in this
 * file are elsewhere on purpose - hp regeneration is a chassis property (S3) and the per-enemy
 * contact cooldown is the detection stage's clock (S8).
 *
 * ---------------------------------------------------------------------------------------------
 * ORDER IS THE CONTRACT
 * ---------------------------------------------------------------------------------------------
 * Hits are applied in HitBuffer order, which S8 built projectile-major with a strict total order
 * inside each shell. So when two shells kill two enemies on the same tick, the KillFeed order -
 * and therefore the gem spawn order, and therefore every gem spawnId - is a deterministic function
 * of the pool state, not of anything's iteration whim. Simultaneous deaths are not a special case;
 * they are just adjacent entries.
 *
 * Contacts are applied AFTER hits, which is the player-favouring order and the honest one: an
 * enemy your shell killed this tick does not also get to bite you. It is dead at the moment the
 * contact would land, and the contact is dropped without arming its cooldown.
 *
 * BEAMS ARE APPLIED FIRST, before hits, because that is when they happened: a beam is decided at
 * S6 and a projectile impact at S8, so beam-then-hit-then-contact is simply chronological order.
 * It matters for exactly one observable - which kill reaches the KillFeed first when a beam and a
 * shell finish two different enemies on the same tick, and therefore which gem gets the lower
 * spawnId - and that has to be decided by a stated rule rather than by whichever loop happened to
 * be written first.
 *
 * ---------------------------------------------------------------------------------------------
 * BEAM DAMAGE IS ALREADY SCALED
 * ---------------------------------------------------------------------------------------------
 * `beams.damage[i]` is dps x dt, computed by the one system that knows a beam is continuous.
 * Nothing here rescales it, and `dt` stays unused in this file - which is what keeps a beam
 * dealing exactly its listed damage per second regardless of anything below this comment.
 *
 * ---------------------------------------------------------------------------------------------
 * ARMOUR - the exact formula, quoted from CombatTuning
 * ---------------------------------------------------------------------------------------------
 *     taken = max(raw * armourMinFrac, raw - armour) * damageTakenMul
 *
 * Flat subtraction with a 25% floor is strong against runts and weak against elites BY DESIGN:
 * 8 armour turns a 5-damage runt bite into 1.25 (the floor) but a 28-damage elite slam into 20
 * (the subtraction). Armour buys tolerance for being SURROUNDED, never for being hit by the big
 * thing - which is exactly the shape of problem a flat-armour build should have.
 *
 * ---------------------------------------------------------------------------------------------
 * THE ENERGY SHIELD - the other half of that trade
 * ---------------------------------------------------------------------------------------------
 * A shield layer prevents ONE hit outright, whatever its size, so it is worth most against exactly
 * the big thing armour is worst against: a boss slam and a runt nibble cost the same one rim.
 * The two defensive passives are deliberately not interchangeable, and a build that wants to
 * survive both has to spend two of its five passive slots.
 *
 * It is applied AFTER the armour formula so the amount it reports preventing is the amount the
 * player would really have lost. See applyContacts.
 *
 * ---------------------------------------------------------------------------------------------
 * PIERCE FALLOFF, carried on the shell
 * ---------------------------------------------------------------------------------------------
 * Each pass multiplies the shell's OWN carried damage by `pierceFalloff`, rather than computing a
 * power of it from a pass counter. Two reasons, both load-bearing:
 *   - a shell's passes can span several ticks (it flies out of one body and into the next three
 *     ticks later), and decaying the stored value is the only version of this that does not need a
 *     "how many bodies have I been through" field that would have to be reaped and hashed;
 *   - it is one multiply, and `Math.pow` is banned in core.
 * pierceLeft is decremented in the same place, and the shell dies when it goes negative - so
 * "pierce 2 hits three bodies" is a property of two adjacent lines rather than of two systems
 * agreeing.
 */

import { ARCHETYPES } from '../content/enemyCatalog.js';
import { WEAPON_CATALOG } from '../content/weaponCatalog.js';
import { RANKS, RANK_BOSS, RANK_ELITE, RANK_REGULAR } from '../content/cycles.js';
import {
  ENEMY_FLAG_ANCHORED,
  ENEMY_FLAG_SECONDARY,
  ENEMY_FLAG_BOSS,
  ENEMY_FLAG_ELITE,
  ENEMY_FLAG_DEAD,
  markEnemyDead,
} from '../entity/enemyPool.js';
import {
  PROJECTILE_FLAG_DEAD,
  markProjectileDead,
} from '../entity/projectilePool.js';
import {
  EV_ENEMY_DAMAGED,
  EV_ENEMY_KILLED,
  EV_PHASE_CHANGED,
  EV_PLAYER_DAMAGED,
  EV_PLAYER_SAVED,
  EV_PLAYER_SHIELD_BROKEN,
  EV_PROJECTILE_DETONATED,
  EV_PROJECTILE_HIT,
  NO_BEAM_TARGET,
  pushEvent,
  pushKill,
  NO_DIRECT_HIT,
} from '../events/ring.js';
import { SLOW_FRAC_MAX, SPLASH_RIM_FRAC } from '../constants.js';
import { breakLootIn } from './pickups.js';
import { queryCircleLiveInto } from '../spatial/hashGrid.js';
import { RUN_PHASE_DEAD, type World } from '../types.js';
import { metaTierOf } from '../data/meta.js';
import { KILL_REASON_KILLED } from './enemyAI.js';

/**
 * Seconds of total immunity Mech Insurance opens when it pays out.
 *
 * Long enough to walk out of the crowd that just killed you and no longer - the upgrade is a second
 * chance at the run, not a window to fight in.
 */
const INSURANCE_INVULN_SEC = 3;

/**
 * Credits `amount` of EFFECTIVE damage to the weapon in loadout slot `slot`, and to the run total.
 *
 * ONE FUNCTION, CALLED AT EVERY SITE THAT DEALS DAMAGE, because the breakdown is only worth
 * having if it adds up: `damageDealt` and the sum of `damageByWeapon` are written here together
 * and can therefore never drift. A site that incremented the total by hand would produce a
 * breakdown that silently fails to account for some of it, which is worse than no breakdown.
 *
 * The slot is resolved to a CATALOG index here rather than stored as a slot, so the summary can
 * name the gun. Slots are stable for a run but mean nothing across two.
 */
function creditWeapon(world: World, slot: number, amount: number): void {
  world.stats.damageDealt += amount;
  const inst = world.weapons[slot];
  if (inst === undefined) return;
  const defId = inst.defId;
  if (defId >= 0 && defId < world.stats.damageByWeapon.length) {
    world.stats.damageByWeapon[defId] += amount;
  }
}

export function updateDamage(world: World, dt: number): void {
  applyBeams(world);
  applyHits(world);
  applyContacts(world);
  advanceBurning(world, dt);
  advanceSlows(world, dt);
}

/**
 * Runs every slow down, and clears the pair when it expires.
 *
 * A SEPARATE PASS FROM `advanceBurning`, though both walk the same array and could have shared
 * one. They are different lengths of thing: a burn bills damage and therefore has to go through
 * `damageEnemy`, kill credit and all, while a slow only counts down. Folding the second into the
 * first would put a `if (slowLeft > 0)` inside a loop that already `continue`s on `burnLeft <= 0`
 * - so every slowed-but-not-burning body would be skipped, which is most of them.
 *
 * `slowFrac` IS CLEARED WITH THE TIMER, not left behind. Nothing reads it while `slowLeft` is 0,
 * so leaving it would be harmless to play and poisonous to the hash: two worlds identical in every
 * observable way would differ in a dead field, and the golden corpus would report a divergence
 * with nothing to see.
 *
 * CLAMPED AT ZERO for the reason `advanceBurning` clamps - a field that drifts negative changes
 * the world hash for every body that was ever slowed.
 */
function advanceSlows(world: World, dt: number): void {
  const enemies = world.enemies;
  const left = enemies.slowLeft;
  const n = enemies.count;

  for (let d = 0; d < n; d++) {
    const t = left[d];
    if (t <= 0) continue;
    const next = t - dt;
    if (next > 0) {
      left[d] = next;
    } else {
      left[d] = 0;
      enemies.slowFrac[d] = 0;
    }
  }
}

/**
 * FIRE, TICKING. Bodies the Plasma Thrower has lit take their damage here and nowhere else.
 *
 * IN THIS FILE BECAUSE BURNING IS DAMAGE. It needs `killEnemy` and `creditWeapon`, which are the
 * two things that make a burn kill indistinguishable from a shell kill - a gem drops, the
 * archetype tally moves, the weapon gets its damage credited. A burn pass written beside the
 * contact timers in collision.ts would have had to reimplement both, and the second copy of a
 * kill path is how a weapon quietly stops earning its own unlock.
 *
 * LAST IN THE TICK, after the shots have landed. A body lit this tick starts burning on the next
 * one rather than taking its first fire damage in the same instant as the bolt - which is both
 * easier to reason about and what stops a single hit reading as double damage.
 *
 * THE COUNT IS TAKEN BEFORE THE DECREMENT, so a body with a sliver of fire left still counts as
 * alight this tick. `peakBurning` is what the Plasma Thrower's own unlock reads, and it is a
 * high-water mark rather than a total - see RunStats.
 *
 * CLAMPED AT ZERO, never negative, for the reason `advanceContactTimers` clamps: a field that
 * drifts below zero changes the world hash for every enemy that ever caught fire.
 */
function advanceBurning(world: World, dt: number): void {
  const enemies = world.enemies;
  const left = enemies.burnLeft;
  const n = enemies.count;
  let alight = 0;

  for (let d = 0; d < n; d++) {
    const t = left[d];
    if (t <= 0) continue;
    if ((enemies.flags[d] & ENEMY_FLAG_DEAD) !== 0) continue;

    alight++;

    const next = t - dt;
    left[d] = next > 0 ? next : 0;

    const dmg = enemies.burnDps[d] * dt;
    if (dmg <= 0) continue;

    // THE SLOT THAT LIT IT, which is what `damageEnemy` passes on to `killEnemy` and
    // `creditWeapon`. 255 is nobody and resolves to no weapon, so an unattributed fire still
    // damages and simply credits nothing rather than crediting slot 0.
    damageEnemy(world, d, dmg, enemies.burnBy[d]);
  }

  if (alight > world.stats.peakBurning) world.stats.peakBurning = alight;
}

/**
 * HIT POINTS OFF, DAMAGE CREDITED, AND THE KILL PATH TAKEN IF IT FALLS - the smallest complete
 * way to hurt something, with no geometry and no projectile behind it.
 *
 * THE TWO CALLERS ARE THE TWO SOURCES OF DAMAGE-OVER-TIME: fire on a body (`advanceBurning`) and
 * sludge on the ground (systems/puddles.ts). Both share exactly one problem - they bill a body
 * that no shot is currently touching - and the thing they must not do is invent a second kill
 * path. A burn kill and a puddle kill drop a gem, move the archetype tally, feed the kill list
 * and credit the weapon precisely as a shell kill does, and this is the one line that guarantees
 * it.
 *
 * NO EV_ENEMY_DAMAGED, deliberately, and it is the same argument `applyBeams` makes for a beam:
 * the event exists to make the renderer flash a body that has just been HIT, and a source that
 * bills sixty times a second would hold every victim permanently white.
 */
export function damageEnemy(world: World, ed: number, amount: number, bySlot: number): void {
  if (amount <= 0) return;
  const enemies = world.enemies;
  const hp = enemies.hp[ed] - amount;
  enemies.hp[ed] = hp;
  creditWeapon(world, bySlot, amount);
  if (hp <= 0) killEnemy(world, ed, bySlot);
}

/**
 * Sets a body alight, or refreshes a fire already on it.
 *
 * THE STRONGER FIRE WINS AND THE LONGER ONE LASTS, judged separately. A second bolt into a body
 * already burning should never make it burn WEAKER, and should never cut the fire short - so the
 * rate takes the max and the duration takes the max, and the igniter is whoever owns the stronger
 * rate. Refreshing both blindly would let a grazing hit downgrade a fire a moment after a solid
 * one lit it.
 */
export function ignite(
  world: World,
  ed: number,
  dps: number,
  seconds: number,
  bySlot: number,
): void {
  if (dps <= 0 || seconds <= 0) return;
  const enemies = world.enemies;
  if ((enemies.flags[ed] & ENEMY_FLAG_DEAD) !== 0) return;

  markSecondary(world, ed);

  if (dps >= enemies.burnDps[ed]) {
    enemies.burnDps[ed] = dps;
    enemies.burnBy[ed] = bySlot;
  }
  if (seconds > enemies.burnLeft[ed]) enemies.burnLeft[ed] = seconds;
}

/**
 * Counts this body against `RunStats.secondaryTouched`, once and only once.
 *
 * THE THREE CALLERS ARE THE THREE SECONDARY EFFECTS - `ignite`, `chill`, and the sludge pool's
 * damage pass. One function rather than three copies of the same two lines, for the reason
 * `creditWeapon` is one function: a tally is only worth having if every site that should touch it
 * does, and a fourth effect added later has one obvious place to call.
 *
 * NOT INSIDE `damageEnemy`. That is the generic "take hit points off" path and a burn already goes
 * through it - so marking there would count the fire twice and, worse, would count nothing for a
 * slow, which deals no damage at all.
 */
export function markSecondary(world: World, ed: number): void {
  const enemies = world.enemies;
  if ((enemies.flags[ed] & ENEMY_FLAG_SECONDARY) !== 0) return;
  enemies.flags[ed] |= ENEMY_FLAG_SECONDARY;
  world.stats.secondaryTouched++;
}

/**
 * Slows a body, or refreshes a slow already on it.
 *
 * THE SAME TWO-MAXIMA RULE `ignite` USES, and for the same reason: a second bolt into a crowd
 * already dragging must never make it FASTER, and must never cut the slow short - so the strength
 * takes the max and the duration takes the max, judged separately. Refreshing both blindly would
 * let the rim of one blast downgrade a slow the centre of another had just laid on.
 *
 * NO `bySlot`. A slow kills nothing, so there is nothing to credit - which is why the pool carries
 * two fields here against the burn's three.
 *
 * CLAMPED BELOW 1. A frac of 1 is a body stopped dead forever-ish, which is a stun and not a slow;
 * the catalog authors 0.35 today and this is the guard that keeps a future typo from shipping an
 * unmoving horde rather than a slow one.
 */
export function chill(world: World, ed: number, frac: number, seconds: number): void {
  if (frac <= 0 || seconds <= 0) return;
  const enemies = world.enemies;
  if ((enemies.flags[ed] & ENEMY_FLAG_DEAD) !== 0) return;

  markSecondary(world, ed);

  const capped = frac > SLOW_FRAC_MAX ? SLOW_FRAC_MAX : frac;
  if (capped > enemies.slowFrac[ed]) enemies.slowFrac[ed] = capped;
  if (seconds > enemies.slowLeft[ed]) enemies.slowLeft[ed] = seconds;
}

// -------------------------------------------------------------------------------------------
// Beams
// -------------------------------------------------------------------------------------------

/**
 * Applies the beams S6 fired, through the SAME kill path as a shell: hp down, effective damage
 * into RunStats, EV_ENEMY_DAMAGED for the renderer, and `killEnemy` on the way through zero - so
 * a laser kill produces a gem, a kill-feed entry and an archetype tally identical to a Cannon
 * kill, and S10 cannot tell them apart.
 *
 * WHAT IT DELIBERATELY DOES NOT DO:
 *   - no knockback. There is no field for it in the buffer; see fireBeam.
 *   - no splash. A beam is a line, and every splash number on a laser is 0 anyway.
 *   - no `shotsFired` / `shotsHit`. Those two are a matched pair whose ratio the harness prints
 *     as accuracy; a beam has no discrete shot, and counting sixty "hits" a second against zero
 *     shots fired would print an accuracy above 100% and quietly destroy the only number that
 *     tells you whether the Cannon is missing.
 *   - no EV_PROJECTILE_HIT. There is no projectile; the beam's own geometry is in world.beams,
 *     which is what the renderer draws.
 */
function applyBeams(world: World): void {
  const beams = world.beams;
  if (beams.count === 0) return;

  const enemies = world.enemies;

  for (let i = 0; i < beams.count; i++) {
    const ed = beams.enemyDense[i];
    // The beam reached its full length without touching anything. Geometry only - the renderer
    // still draws it; there is nothing to bill.
    if (ed === NO_BEAM_TARGET) continue;

    // Killed by an earlier beam this tick (two lasers finishing the same runt), or by
    // anything else that ran before S9. Overkill is not charged.
    if ((enemies.flags[ed] & ENEMY_FLAG_DEAD) !== 0) continue;

    const raw = beams.damage[i];
    if (raw <= 0) continue;

    const hpBefore = enemies.hp[ed];
    enemies.hp[ed] = hpBefore - raw;
    // Effective, not raw: the last tick of a burn that overkills a 0.3 HP runt must not
    // inflate the dps the harness prints. The beam buffer carries the firing slot, so a laser's
    // share of the run's damage costs one array write on top of the one already happening.
    creditWeapon(world, beams.weaponIdx[i], raw < hpBefore ? raw : hpBefore);

    pushEvent(
      world.events,
      EV_ENEMY_DAMAGED,
      world.tick,
      enemies.x[ed],
      enemies.y[ed],
      raw,
      enemies.slot[ed],
    );

    if (enemies.hp[ed] <= 0) killEnemy(world, ed, beams.weaponIdx[i]);
  }
}

// -------------------------------------------------------------------------------------------
// Projectile hits
// -------------------------------------------------------------------------------------------

function applyHits(world: World): void {
  const hits = world.hits;
  if (hits.count === 0) return;

  const proj = world.projectiles;
  const enemies = world.enemies;
  const stats = world.stats;
  const falloff = world.config.tuning.combat.pierceFalloff;

  for (let i = 0; i < hits.count; i++) {
    const pd = hits.projectileDense[i];
    const ed = hits.enemyDense[i];

    // FUSE DETONATION: a missile that ran out of flight time explodes in open air. There is no
    // struck body, so there is no direct damage, no knockback and no pierce pass to spend - only
    // splash, at full strength rather than the fraction a contact hit passes on. The shell is
    // already flagged dead by S7; the PROJECTILE_FLAG_DEAD guard below would otherwise drop this.
    if (ed === NO_DIRECT_HIT) {
      const r = proj.splashRadius[pd];
      const f = proj.splashFrac[pd];
      if (r > 0 && f > 0) {
        applySplash(world, hits.x[i], hits.y[i], r, proj.damage[pd] * f, -1, proj.ownerWeapon[pd]);
      }
      // The RADIUS, not the dense index. The renderer draws a crater the size of the blast, and
      // by the time it looks the shell has been reaped - this event is the only place that number
      // survives the tick.
      pushEvent(
        world.events,
        EV_PROJECTILE_DETONATED,
        world.tick,
        hits.x[i],
        hits.y[i],
        r,
        proj.visualId[pd],
      );
      continue;
    }

    // A body killed by an earlier hit THIS TICK absorbs nothing more - and, deliberately, does not
    // consume the shell's pass either. Overkill is not charged to the player: the shell carries on
    // and looks for something still standing, which is the same principle that stops the Cannon
    // burning a 1.2 s cooldown on a corpse.
    if ((enemies.flags[ed] & ENEMY_FLAG_DEAD) !== 0) continue;
    if ((proj.flags[pd] & PROJECTILE_FLAG_DEAD) !== 0) continue;

    const raw = proj.damage[pd];
    const hpBefore = enemies.hp[ed];
    enemies.hp[ed] = hpBefore - raw;

    // Effective, not raw: overkill on a 3 HP runt must not inflate the dps the harness prints.
    creditWeapon(world, proj.ownerWeapon[pd], raw < hpBefore ? raw : hpBefore);
    // One per PASS, so a pierce-3 shell registers up to four. This is "hits landed", not
    // "shells that connected" - the harness divides by shotsFired knowing that.
    stats.shotsHit++;

    pushEvent(world.events, EV_PROJECTILE_HIT, world.tick, hits.x[i], hits.y[i], raw, pd);
    pushEvent(
      world.events,
      EV_ENEMY_DAMAGED,
      world.tick,
      enemies.x[ed],
      enemies.y[ed],
      raw,
      enemies.slot[ed],
    );

    applyKnockback(world, ed, proj.vx[pd], proj.vy[pd], proj.knockback[pd]);

    // FIRE, IF THE GUN THAT FIRED THIS SETS FIRES. Read off the weapon def at IMPACT rather than
    // carried on the projectile, which would have been two more fields in the pool and therefore
    // two more entries in the hash format - for a fact that has not changed since the bolt left
    // the muzzle. The rate is a fraction of the hit that lit it (WeaponDef.burn), so a damage
    // tier and a chassis bonus both raise the fire without either of them naming fire.
    const owner = world.weapons[proj.ownerWeapon[pd]];
    if (owner !== undefined) {
      const burn = WEAPON_CATALOG[owner.defId].burn;
      if (burn !== undefined) {
        ignite(world, ed, raw * burn.dpsFrac, burn.seconds, proj.ownerWeapon[pd]);
      }
      // AND THE BODY THE BOLT ACTUALLY STRUCK IS SLOWED TOO. It sits at the dead centre of the
      // blast and is the one thing `applySplash` deliberately excludes (it already took the direct
      // hit), so without this the mark would be the single body in the whole circle walking away
      // at full speed - the effect visibly failing on the target you aimed at.
      const slow = WEAPON_CATALOG[owner.defId].slow;
      if (slow !== undefined) chill(world, ed, slow.frac, slow.seconds);
    }

    if (enemies.hp[ed] <= 0) killEnemy(world, ed, proj.ownerWeapon[pd]);

    // Splash is centred on the impact point, not on the victim, so a shell that clips the edge of
    // a bruiser still catches the chaff behind it rather than the chaff behind the bruiser.
    const splashRadius = proj.splashRadius[pd];
    const splashFrac = proj.splashFrac[pd];
    if (splashRadius > 0 && splashFrac > 0) {
      applySplash(world, hits.x[i], hits.y[i], splashRadius, raw * splashFrac, ed, proj.ownerWeapon[pd]);
    }

    // The pass is spent. Falloff decays the carried damage for whatever this shell meets next,
    // including on a later tick.
    proj.damage[pd] = raw * falloff;
    const left = proj.pierceLeft[pd] - 1;
    proj.pierceLeft[pd] = left;
    if (left < 0) markProjectileDead(proj, pd);
  }
}

/**
 * Knockback goes into `pushX/pushY`, never into `vx/vy`: the next tick's seek pass overwrites
 * steering velocity from scratch, so a punt written there would be invisible. Impulse is scaled by
 * 1/mass, the same number separation uses - which is what makes a 190-knockback shell throw a
 * 0.5-mass runt at 380 u/s and shove a 7-mass elite by 27.
 *
 * ANCHORED bodies (the Scraplord) are immune. Its mass is 1e9 rather than Infinity precisely so
 * that a missed flag check would produce a harmless ~0 rather than a NaN that would poison the
 * pool's hashed bytes for the rest of the run - but the flag is checked anyway.
 */
function applyKnockback(world: World, ed: number, vx: number, vy: number, amount: number): void {
  if (amount <= 0) return;
  const enemies = world.enemies;
  if ((enemies.flags[ed] & ENEMY_FLAG_ANCHORED) !== 0) return;
  const l2 = vx * vx + vy * vy;
  if (l2 === 0) return;
  // knockbackTake is the body's own resistance (a Heavy takes half); mass is the shared 1/mass
  // that separation also uses. Two numbers because they answer two different questions - see
  // FlavourDef.knockback.
  const k = (amount * enemies.knockbackTake[ed]) / enemies.mass[ed] / Math.sqrt(l2);
  enemies.pushX[ed] += vx * k;
  enemies.pushY[ed] += vy * k;
}

/**
 * Blast damage to every live enemy whose CENTRE is inside `radius` of the impact, excluding the
 * body that was hit directly (it already took the full shell).
 *
 * Centre-inside rather than body-overlap keeps the number on the card honest: a 34 u splash is a
 * 34 u circle, which is also exactly the circle the renderer draws. It carries no knockback - a
 * shell should shove what it HITS, and a blast that punted the whole crowd would undo the
 * separation gradient that makes the horde readable.
 *
 * IT FALLS OFF. `amount` is what a body AT THE EPICENTRE takes; a body at the rim takes
 * SPLASH_RIM_FRAC of it, linearly interpolated by distance. See that constant for why the edge is
 * worth something rather than nothing.
 *
 * The credited figure is the scaled one, not `amount`, so the harness's damage-by-source table
 * still sums to `damageDealt` - the overkill clamp stays on the same line it always was.
 */
function applySplash(
  world: World,
  x: number,
  y: number,
  radius: number,
  amount: number,
  exclude: number,
  /** Loadout slot of the weapon whose shell this was - a blast belongs to the gun that threw it. */
  slot: number,
): void {
  if (amount <= 0) return;

  // A BLAST TAKES OUT DRUMS IT LANDS ON. Without this the artillery could never break a barrel at
  // all - it has no direct contact to speak of (it detonates on its fuse over open ground), so the
  // one weapon most likely to be dropping shells on scenery would be the one weapon that could
  // not set any of it off.
  breakLootIn(world, x, y, radius, amount);

  const enemies = world.enemies;
  const candidates = world.scratch.candidates;
  const found = queryCircleLiveInto(world.spatial, enemies, x, y, radius, candidates);
  if (found === 0) return;

  const r2 = radius * radius;
  // Precomputed so the per-body work is one sqrt, one multiply and one add.
  const falloff = (1 - SPLASH_RIM_FRAC) / radius;

  // DOES THIS BLAST SET FIRES? Resolved once, outside the loop, rather than per body - the answer
  // is a property of the gun and cannot change between two victims of the same shell.
  //
  // THE FIRE DOES NOT FALL OFF WITH THE BLAST, and that is the point of it on the Plasma Thrower:
  // its splash is deliberately almost no damage, so a burn scaled by that damage would be almost
  // no burn and the AoE would do nothing at all. What the blast spreads is the FIRE, at the rate a
  // direct hit would have started it, and the damage is a rounding error beside it.
  const owner = world.weapons[slot];
  const burn = owner === undefined ? undefined : WEAPON_CATALOG[owner.defId].burn;
  const burnDps = burn === undefined ? 0 : owner!.stats.damage * burn.dpsFrac;

  // DOES THIS BLAST SLOW? Resolved once, outside the loop, for the reason the burn above is: it is
  // a property of the gun and cannot differ between two victims of the same shell.
  //
  // AND IT DOES NOT FALL OFF WITH THE BLAST, exactly as the fire does not. A body clipped by the
  // rim is standing in the same field as one at the centre; scaling the slow by distance would
  // make the edge of the circle do visibly nothing, which is the complaint SPLASH_RIM_FRAC already
  // answers for damage by refusing to reach zero.
  const slow = owner === undefined ? undefined : WEAPON_CATALOG[owner.defId].slow;

  for (let i = 0; i < found; i++) {
    const ed = candidates[i];
    if (ed === exclude) continue;
    const dx = enemies.x[ed] - x;
    const dy = enemies.y[ed] - y;
    const d2 = dx * dx + dy * dy;
    if (d2 > r2) continue;

    // Math.sqrt only - exactly rounded by IEEE-754 and therefore safe in core, unlike pow/sin/cos.
    const scaled = amount * (1 - Math.sqrt(d2) * falloff);
    if (scaled <= 0) continue;

    const hpBefore = enemies.hp[ed];
    enemies.hp[ed] = hpBefore - scaled;
    creditWeapon(world, slot, scaled < hpBefore ? scaled : hpBefore);
    pushEvent(
      world.events,
      EV_ENEMY_DAMAGED,
      world.tick,
      enemies.x[ed],
      enemies.y[ed],
      scaled,
      enemies.slot[ed],
    );
    // LIT BEFORE THE KILL CHECK, so a body the blast finishes still counted as burning for the
    // tick it died on - `peakBurning` is a high-water mark and a fire that never registered is a
    // fire the unlock never saw.
    if (burn !== undefined) ignite(world, ed, burnDps, burn.seconds, slot);
    // Slowed before the kill check for the reason the fire is lit before it: a body the blast
    // finishes still spent the tick it died on inside the field.
    if (slow !== undefined) chill(world, ed, slow.frac, slow.seconds);

    if (enemies.hp[ed] <= 0 && (enemies.flags[ed] & ENEMY_FLAG_DEAD) === 0) {
      // The blast was the killing blow. Guarded on DEAD exactly as killEnemy itself is, so a
      // body two blasts reach in one tick counts one splash kill, not two.
      killEnemy(world, ed, slot);
      world.stats.splashKills++;
    }
  }
}

/**
 * The single kill site for damage-caused deaths.
 *
 * It MARKS and records; it never removes (S12 is the only removal site, which is what keeps every
 * dense index and hash entry valid for the rest of the tick). The KillFeed entry carries the
 * position, xp value, archetype and flags because by the time S10 spawns the gem the corpse still
 * exists but by the time the renderer looks it will not - and because reading them here is one
 * cache line that is already hot.
 *
 * The DEAD guard is what makes double-kills free: two shells landing on the same 3 HP runt in
 * one tick produce one kill, one gem and one increment of RunStats.
 */
function killEnemy(world: World, ed: number, killerSlot: number): void {
  const enemies = world.enemies;
  if ((enemies.flags[ed] & ENEMY_FLAG_DEAD) !== 0) return;

  markEnemyDead(enemies, ed);

  const stats = world.stats;
  stats.kills++;
  stats.killsByArchetype[enemies.archetype[ed]]++;
  stats.killsByFlavour[enemies.flavourId[ed]]++;
  // Rank comes off the flags the kill path already loaded - no second field in the pool.
  const kf = enemies.flags[ed];
  const rank =
    (kf & ENEMY_FLAG_BOSS) !== 0 ? RANK_BOSS : (kf & ENEMY_FLAG_ELITE) !== 0 ? RANK_ELITE : RANK_REGULAR;
  stats.killsByRank[rank]++;

  // THE BOUNTY. Paid here, at the one place that has already worked out the rank, rather than
  // anywhere a coin is handled: nothing is dropped, nothing is walked over, and a boss killed on
  // the far side of the yard pays exactly what one killed at your feet does. See PickupTuning.
  //
  // `rank` IS THE GUARD against a body flagged both ways. It is one value off a ladder that puts
  // boss above elite, so the two arms below cannot both run - the else is readability, not the
  // thing keeping a boss from being paid twice.
  const bounty = world.config.tuning.pickups;
  if (rank === RANK_BOSS) stats.credits += bounty.creditPerBoss;
  else if (rank === RANK_ELITE) stats.credits += bounty.creditPerElite;
  // WHICH CREATURE, AT WHICH RANK - what the bestiary is gated on. The rung was stamped at spawn
  // (spawning.ts) precisely so this line can exist: by now the director has moved on and only the
  // body itself still knows what it is.
  stats.killsByCycleRank[enemies.cycleIndex[ed] * RANKS.length + rank]++;

  // WHAT WAS IN YOUR HANDS WHEN A BOSS WENT DOWN. Recorded HERE rather than reconstructed at run
  // end, because the loadout at the end is not the loadout at the moment - see RunStats. Bosses
  // are the rarest thing in the game and this is five increments when one dies, so the loop costs
  // nothing measurable and buys a fact that is otherwise unrecoverable.
  const isBoss = (kf & ENEMY_FLAG_BOSS) !== 0;
  if (isBoss) {
    for (let i = 0; i < world.weaponCount; i++) stats.bossKillsByWeapon[world.weapons[i].defId]++;
  }

  // WHO FINISHED IT. -1 is the Energy Shield's backlash, which has no slot - see the call site.
  const killer = killerSlot >= 0 ? (world.weapons[killerSlot]?.defId ?? -1) : -1;
  if (killer >= 0) {
    stats.killsByWeapon[killer]++;
    // The same kill again, against the rank it was standing on - see RunStats.killsByWeaponRank.
    // The row sum of this IS killsByWeapon above, which a test pins.
    stats.killsByWeaponRank[killer * RANKS.length + rank]++;
  }

  pushKill(
    world.kills,
    enemies.x[ed],
    enemies.y[ed],
    enemies.xpValue[ed],
    enemies.archetype[ed],
    enemies.flavourId[ed],
    enemies.flags[ed],
  );

  // reason 0 = KILLED (play the death FX, a gem is coming). enemyAI emits reason 1 for a despawn,
  // which pays nothing - a kill you did not make must not drop loot.
  pushEvent(
    world.events,
    EV_ENEMY_KILLED,
    world.tick,
    enemies.x[ed],
    enemies.y[ed],
    enemies.slot[ed],
    KILL_REASON_KILLED,
  );
}

/**
 * The Energy Shield's discharge into whatever broke it.
 *
 * Split out rather than inlined because it is the ONE place in this file where damage flows
 * backwards - player defence killing an enemy - and burying that inside the contact loop would
 * hide the fact that `killEnemy` can now be reached from the contact path at all. S10 spawns the
 * gem from the KillFeed later this same tick, exactly as it would for a shell.
 */
function applyShieldBacklash(world: World, ed: number, amount: number): void {
  if (amount <= 0) return;
  const enemies = world.enemies;

  const hpBefore = enemies.hp[ed];
  enemies.hp[ed] = hpBefore - amount;
  // Effective, not raw: 30 backlash into a 22 HP Rustling is 22 dealt, not 30. Overkill here
  // would inflate the dps the harness prints by an amount that scales with how often you are hit,
  // which is the last thing that number should measure.
  //
  // Credited to the SHIELD, not to a weapon: it is the only damage in the game that no gun dealt,
  // and folding it into whatever happened to be in slot 0 would hide a build whose second-best
  // damage source is a defensive passive.
  const effective = amount < hpBefore ? amount : hpBefore;
  world.stats.damageDealt += effective;
  world.stats.damageByShield += effective;

  pushEvent(
    world.events,
    EV_ENEMY_DAMAGED,
    world.tick,
    enemies.x[ed],
    enemies.y[ed],
    amount,
    enemies.slot[ed],
  );

  // NO KILLING WEAPON: the backlash is the Energy Shield, which is not in a slot. -1 rather than
  // slot 0, because attributing a shield kill to whatever gun happened to be first would be a lie
  // in exactly the statistic that exists to answer "what finished it".
  if (enemies.hp[ed] <= 0) killEnemy(world, ed, -1);
}

// -------------------------------------------------------------------------------------------
// Contact damage
// -------------------------------------------------------------------------------------------

function applyContacts(world: World): void {
  const contacts = world.contacts;
  if (contacts.count === 0) return;

  const enemies = world.enemies;
  const player = world.player;
  const combat = world.config.tuning.combat;
  const armour = player.stats.armour;
  const takenMul = player.stats.damageTakenMul;

  for (let i = 0; i < contacts.count; i++) {
    const ed = contacts.enemyDense[i];
    // Killed by a shell earlier in this same stage. It bites nothing, and its cooldown is left
    // alone - there is nothing left to arm it for.
    if ((enemies.flags[ed] & ENEMY_FLAG_DEAD) !== 0) continue;

    const raw = enemies.contactDamage[ed];
    // Rearmed HERE, at the moment the player is actually billed. S8 owns running it down.
    enemies.contactTimer[ed] = ARCHETYPES[enemies.archetype[ed]].contactInterval;

    const floor = raw * combat.armourMinFrac;
    const subtracted = raw - armour;
    const taken = (subtracted > floor ? subtracted : floor) * takenMul;

    // ENERGY SHIELD, applied AFTER armour and the damage multiplier, so the number the shield
    // reports having prevented is the number the player would actually have lost. Nothing about
    // the ordering changes the outcome - a prevented hit is prevented whatever its size - but it
    // makes EV_PLAYER_SHIELD_BROKEN's payload comparable with `damageTaken`.
    //
    // IMMUNITY FIRST. While the window from the last break is open the bite is eaten whole: no
    // damage, no second layer spent, and no event. The biter's cooldown is still rearmed above,
    // which is the whole point of the window - a crowd that all reach you on the same tick spend
    // their bites against 0.2 s of immunity instead of queueing up to land the instant it ends.
    //
    // A RIM IS ONLY EVER SPENT ON A BITE THAT WOULD OTHERWISE HAVE COST HIT POINTS, and both halves
    // of that are checked here rather than only the first. `invulnLeft` is the immunity the game
    // has today - a shield break's own window, and the workshop's insurance payout - and it is the
    // one that matters in a real run. The second test is the general form of the same rule: a bite
    // resolving to nothing takes nothing, whatever made it nothing. Shipped play cannot reach it
    // (`resolvePlayerStats` floors `damageTakenMul` at 0.25 and armour cannot cut below
    // `armourMinFrac` of the raw), so it costs one comparison and exists so that the day something
    // else makes the pilot untouchable, the shield is not quietly eaten by a crowd that is doing no
    // damage - which is the one failure mode of a defensive card that a player would never see
    // coming and could never diagnose.
    if (player.invulnLeft > 0 || taken <= 0) continue;

    if (player.shieldLayers > 0) {
      player.shieldLayers--;
      // The window opens even at 0 immunity (an unreachable state today - the unlock tier carries
      // 0.1 s - but a tuning sweep to 0 must degrade to "blocks exactly one hit", not to a
      // negative timer that S3 would then have to defend against).
      const window = player.stats.shieldImmune;
      if (window > player.invulnLeft) player.invulnLeft = window;
      // The recharge period starts NOW rather than at the next tick's S3, so a break is worth
      // exactly `shieldRecharge` seconds however late in the tick it happened.
      player.shieldTimer = player.stats.shieldRecharge;
      world.stats.damagePrevented += taken;
      pushEvent(
        world.events,
        EV_PLAYER_SHIELD_BROKEN,
        world.tick,
        player.x,
        player.y,
        taken,
        player.shieldLayers,
      );
      // BACKLASH, to the body that touched the field and nothing else. It goes through the same
      // path a shell does - effective damage into RunStats, EV_ENEMY_DAMAGED for the spark, and
      // `killEnemy` on the way through zero - so a Rustling that dies on a rim drops a gem and
      // lands in the kill feed exactly like one shot off it.
      //
      // The bodies eaten by the IMMUNITY WINDOW take nothing: they hit a field that was already
      // down. Burning the whole crowd would turn a defensive card into the game's best area
      // weapon, which is a different card than the one on offer.
      applyShieldBacklash(world, ed, combat.shieldBreakDamage);
      continue;
    }

    player.hp -= taken;
    world.stats.damageTaken += taken;
    // AFTER the shield and immunity `continue`s above, so this counts bites that actually cost
    // hit points - see RunStats.contactHits.
    world.stats.contactHits++;
    pushEvent(
      world.events,
      EV_PLAYER_DAMAGED,
      world.tick,
      player.x,
      player.y,
      taken,
      enemies.slot[ed],
    );

    if (player.hp <= 0) {
      // ---- MECH INSURANCE, the workshop's one behaviour ------------------------------------
      // Checked BEFORE anything about dying is recorded, because a run this saves did not die: no
      // `killedByRank`, no phase change, and nothing in the summary that says otherwise.
      //
      // The early return matters as much as the heal. A tick can carry several contacts, and
      // without it the very next body in the buffer would take the restored hull straight back
      // down - insurance that pays out and is immediately spent again is insurance that does
      // nothing. The immunity window then covers getting clear of the crowd that did it.
      if (player.insuranceUsed === 0 && metaTierOf(world.meta.tiers, 'm-insurance') > 0) {
        player.insuranceUsed = 1;
        player.hp = player.stats.maxHp;
        // Not `max`: a shield break's window is the player's own doing and this is a bigger event
        // than that, so it is set outright rather than allowed to be shortened by one in progress.
        player.invulnLeft = INSURANCE_INVULN_SEC;
        pushEvent(
          world.events,
          EV_PLAYER_SAVED,
          world.tick,
          player.x,
          player.y,
          INSURANCE_INVULN_SEC,
          0,
        );
        return;
      }

      // WHAT KILLED YOU, read off the flags this loop already has. Recorded before the early
      // return below, which drops every remaining contact - so it is the body that actually landed
      // the last bite and not whichever one happened to be next in the buffer.
      const df = enemies.flags[ed];
      world.stats.killedByRank =
        (df & ENEMY_FLAG_BOSS) !== 0
          ? RANK_BOSS
          : (df & ENEMY_FLAG_ELITE) !== 0
            ? RANK_ELITE
            : RANK_REGULAR;
      // Clamped to exactly 0 so the summary screen and the hashed player struct never carry a
      // negative hp that depends on which runt happened to be last in the buffer.
      player.hp = 0;
      world.phase = RUN_PHASE_DEAD;
      pushEvent(world.events, EV_PHASE_CHANGED, world.tick, RUN_PHASE_DEAD, 0, 0, 0);
      // Remaining contacts are dropped: they cannot make the player any deader, and applying them
      // would make `damageTaken` depend on how many bodies happened to be touching at the end.
      return;
    }
  }
}
