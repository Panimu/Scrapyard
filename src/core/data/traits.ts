/**
 * HERO TRAITS - the optional hooks that let a hero bend the Cannon without the Cannon knowing
 * heroes exist.
 *
 * EMPTY ON PURPOSE. Hero variety is deferred (see data/heroes.ts): every chassis is currently a
 * skin, so no hero registers a hook. updateWeapons already treats a missing entry as "no trait",
 * which costs one property load, so an empty registry is the cheap and normal path rather than a
 * placeholder.
 *
 * The mechanism is kept wired up rather than deleted because it is the extension point that lets
 * a hero be a RULE rather than a magnitude - the same separation that lets weapons 2..12 arrive
 * as pure data. Deleting it would mean re-threading updateWeapons later.
 *
 * RULES FOR ANYTHING ADDED HERE:
 *   1. No allocation - these run inside updateWeapons' per-shell loop.
 *   2. No Math.random, no Date, no reading anything outside `world`. Use world.rng streams if
 *      randomness is genuinely needed, or determinism breaks and every replay with it.
 *   3. Reads of enemy state must go through the dense index handed in, which is valid only for
 *      the current tick.
 *
 * PlayerState.traitScratch (length TRAIT_SCRATCH_LEN = 8) is free per-hero storage for whatever
 * lands here. Document slot ownership per trait; nothing may touch a slot it does not own.
 */

import type { HeroId, HeroTrait } from './heroes.js';

/**
 * Keyed by HeroDef.id. A hero with no entry has no hooks, which is every hero today.
 */
export const HERO_TRAITS: Readonly<Partial<Record<HeroId, HeroTrait>>> = Object.freeze({});
