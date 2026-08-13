/**
 * S9 - updateDamage. APPLICATION. The only stage in the simulation that changes an hp number.
 *
 * It consumes the two buffers S8 filled, in buffer order, and produces:
 *   - enemy hp changes, knockback, splash;
 *   - the KillFeed, which S10 turns into gems THIS SAME TICK;
 *   - player hp changes, and the transition to RUN_PHASE_DEAD;
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
 * ---------------------------------------------------------------------------------------------
 * ARMOUR - the exact formula, quoted from CombatTuning
 * ---------------------------------------------------------------------------------------------
 *     taken = max(raw * armourMinFrac, raw - armour) * damageTakenMul
 *
 * Flat subtraction with a 25% floor is strong against swarmers and weak against elites BY DESIGN:
 * 8 armour turns a 5-damage swarmer bite into 1.25 (the floor) but a 28-damage elite slam into 20
 * (the subtraction). Armour buys tolerance for being SURROUNDED, never for being hit by the big
 * thing - which is exactly the shape of problem a flat-armour build should have.
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
import {
  ENEMY_FLAG_ANCHORED,
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
  EV_PROJECTILE_HIT,
  pushEvent,
  pushKill,
} from '../events/ring.js';
import { queryCircleLiveInto } from '../spatial/hashGrid.js';
import { RUN_PHASE_DEAD, type World } from '../types.js';
import { KILL_REASON_KILLED } from './enemyAI.js';

export function updateDamage(world: World, dt: number): void {
  applyHits(world);
  applyContacts(world);
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

    // A body killed by an earlier hit THIS TICK absorbs nothing more - and, deliberately, does not
    // consume the shell's pass either. Overkill is not charged to the player: the shell carries on
    // and looks for something still standing, which is the same principle that stops the Cannon
    // burning a 1.2 s cooldown on a corpse.
    if ((enemies.flags[ed] & ENEMY_FLAG_DEAD) !== 0) continue;
    if ((proj.flags[pd] & PROJECTILE_FLAG_DEAD) !== 0) continue;

    const raw = proj.damage[pd];
    const hpBefore = enemies.hp[ed];
    enemies.hp[ed] = hpBefore - raw;

    // Effective, not raw: overkill on a 3 HP swarmer must not inflate the dps the harness prints.
    stats.damageDealt += raw < hpBefore ? raw : hpBefore;
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

    if (enemies.hp[ed] <= 0) killEnemy(world, ed);

    // Splash is centred on the impact point, not on the victim, so a shell that clips the edge of
    // a bruiser still catches the chaff behind it rather than the chaff behind the bruiser.
    const splashRadius = proj.splashRadius[pd];
    const splashFrac = proj.splashFrac[pd];
    if (splashRadius > 0 && splashFrac > 0) {
      applySplash(world, hits.x[i], hits.y[i], splashRadius, raw * splashFrac, ed);
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
 * 0.5-mass swarmer at 380 u/s and shove a 7-mass elite by 27.
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
  const k = amount / enemies.mass[ed] / Math.sqrt(l2);
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
 */
function applySplash(
  world: World,
  x: number,
  y: number,
  radius: number,
  amount: number,
  exclude: number,
): void {
  if (amount <= 0) return;
  const enemies = world.enemies;
  const candidates = world.scratch.candidates;
  const found = queryCircleLiveInto(world.spatial, enemies, x, y, radius, candidates);
  if (found === 0) return;

  const r2 = radius * radius;
  for (let i = 0; i < found; i++) {
    const ed = candidates[i];
    if (ed === exclude) continue;
    const dx = enemies.x[ed] - x;
    const dy = enemies.y[ed] - y;
    if (dx * dx + dy * dy > r2) continue;

    const hpBefore = enemies.hp[ed];
    enemies.hp[ed] = hpBefore - amount;
    world.stats.damageDealt += amount < hpBefore ? amount : hpBefore;
    pushEvent(
      world.events,
      EV_ENEMY_DAMAGED,
      world.tick,
      enemies.x[ed],
      enemies.y[ed],
      amount,
      enemies.slot[ed],
    );
    if (enemies.hp[ed] <= 0) killEnemy(world, ed);
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
 * The DEAD guard is what makes double-kills free: two shells landing on the same 3 HP swarmer in
 * one tick produce one kill, one gem and one increment of RunStats.
 */
function killEnemy(world: World, ed: number): void {
  const enemies = world.enemies;
  if ((enemies.flags[ed] & ENEMY_FLAG_DEAD) !== 0) return;

  markEnemyDead(enemies, ed);

  const stats = world.stats;
  stats.kills++;
  stats.killsByArchetype[enemies.archetype[ed]]++;

  pushKill(
    world.kills,
    enemies.x[ed],
    enemies.y[ed],
    enemies.xpValue[ed],
    enemies.archetype[ed],
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

    player.hp -= taken;
    world.stats.damageTaken += taken;
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
      // Clamped to exactly 0 so the summary screen and the hashed player struct never carry a
      // negative hp that depends on which swarmer happened to be last in the buffer.
      player.hp = 0;
      world.phase = RUN_PHASE_DEAD;
      pushEvent(world.events, EV_PHASE_CHANGED, world.tick, RUN_PHASE_DEAD, 0, 0, 0);
      // Remaining contacts are dropped: they cannot make the player any deader, and applying them
      // would make `damageTaken` depend on how many bodies happened to be touching at the end.
      return;
    }
  }
}
