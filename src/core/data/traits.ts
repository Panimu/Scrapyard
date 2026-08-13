/**
 * HERO TRAITS - the optional hooks that let a hero bend the Cannon without the Cannon knowing
 * heroes exist.
 *
 * Most heroes are differentiated purely by their stat multipliers in data/heroes.ts, and that is
 * the preferred way: a number is testable, explainable on a select screen, and cannot introduce a
 * determinism hazard. A trait is for the cases where a hero's identity is a RULE rather than a
 * magnitude.
 *
 * RULES FOR ANYTHING ADDED HERE:
 *   1. No allocation - these run inside updateWeapons' per-shell loop.
 *   2. No Math.random, no Date, no reading anything outside `world`. Use world.rng streams if
 *      randomness is genuinely needed.
 *   3. Reads of enemy state must go through the dense index handed in, which is valid only for
 *      the current tick.
 *
 * PlayerState.traitScratch (length TRAIT_SCRATCH_LEN = 8) is free per-hero storage. Slot meanings
 * are documented per trait below; nothing else may touch a slot it does not own.
 *   - kiln: no slots used.
 */

import { ARCH_BRUISER, ARCH_ELITE, ARCH_BOSS } from '../content/enemyCatalog.js';
import type { HeroId, HeroTrait } from './heroes.js';
import type { World } from '../types.js';

/**
 * Kiln - "hits hardest". Its shells hit heavy targets harder still.
 *
 * This leans deliberately into the Cannon's highest-HP targeting rule: the gun already picks the
 * biggest thing in range, so Kiln is the hero that most rewards that rule - and, with 75% HP, the
 * one punished hardest by the swarmers the rule ignores. The trait sharpens an existing tension
 * rather than adding a new system.
 */
const KILN: HeroTrait = {
  onFireShell: (world: World, shot): void => {
    const d = shot.targetDense;
    if (d < 0 || d >= world.enemies.count) return;
    const arch = world.enemies.archetype[d];
    if (arch === ARCH_BRUISER || arch === ARCH_ELITE || arch === ARCH_BOSS) {
      shot.damage *= 1.25;
    }
  },
};

/**
 * Keyed by HeroDef.id. A hero with no entry simply has no hooks - updateWeapons treats
 * `undefined` as "no trait", so absence is the normal case and costs one property load.
 */
export const HERO_TRAITS: Readonly<Partial<Record<HeroId, HeroTrait>>> = Object.freeze({
  kiln: KILN,
});
