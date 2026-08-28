/**
 * THE SOUND TABLES, held to the two promises they make.
 *
 * There are no audio files yet and nothing plays, so there is no behaviour to test. What CAN rot
 * is the pair of guarantees the tables exist for: that every event kind has been considered, and
 * that no trigger names a sound the library does not have. Both are the kind of thing that breaks
 * quietly - a new event with no sound is indistinguishable from an event deliberately left silent -
 * and both are cheap to pin.
 */

import { describe, expect, it } from 'vitest';

import { EVENT_NAMES } from '../src/core/events/ring.js';
import { WEAPON_CATALOG } from '../src/core/index.js';
import { SFX_BY_ID, SFX_CATALOG, coreSfx, type SfxId } from '../src/render/audio/sfxCatalog.js';
import {
  BLAST_MEDIUM_MAX,
  BLAST_SMALL_MAX,
  EVENT_SFX,
  FIRE_SFX,
  UI_TRIGGERS,
  blastSfxFor,
  deathSfxFor,
  hitSfxFor,
} from '../src/render/audio/sfxTriggers.js';

describe('the sound library', () => {
  it('has no duplicate ids and no duplicate clip keys', () => {
    const ids = SFX_CATALOG.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    const clips = SFX_CATALOG.map((s) => s.clip);
    expect(new Set(clips).size).toBe(clips.length);
  });

  it('names every clip after its own id, so a file can be found from either end', () => {
    for (const s of SFX_CATALOG) expect(s.clip).toBe(`sfx_${s.id}`);
  });

  it('gives anything that can repeat quickly more than one take', () => {
    // The rule from the teardown: a clip the ear can hear twice inside a second needs variation, or
    // the player starts hearing the FILE rather than the event. 150 ms is about that threshold.
    //
    // THE UI BUS IS EXEMPT, AND THAT IS A DESIGN CLAIM RATHER THAN AN EXCUSE. Variation is what
    // stops a world sound becoming a texture; a menu sound wants the OPPOSITE. A confirm that
    // differed slightly each press would read as two different answers to the same question, and
    // the whole value of a UI sound is that it means exactly one thing every time.
    for (const s of SFX_CATALOG) {
      if (s.bus === 'ui') continue;
      if (s.throttleMs > 0 && s.throttleMs <= 150) {
        expect(s.takes, `${s.id} repeats every ${s.throttleMs}ms with ${s.takes} take(s)`)
          .toBeGreaterThan(1);
      }
    }
  });

  it('keeps a minimal set that is genuinely smaller than the whole library', () => {
    const core = coreSfx();
    expect(core.length).toBeGreaterThan(0);
    expect(core.length).toBeLessThan(SFX_CATALOG.length);
  });

  it('mixes the horde under the things that matter', () => {
    // A RELATIVE claim, not an absolute one - the gains are a guide for whoever mixes, but the
    // ORDER between them is a design decision and should survive being remixed. The two loudest
    // sounds in the game are the two that are allowed to interrupt it.
    const gain = (id: SfxId): number => SFX_BY_ID.get(id)!.gain;
    expect(gain('enemy_die')).toBeLessThan(gain('enemy_die_elite'));
    expect(gain('gem_pickup')).toBeLessThan(gain('consumable_pickup'));
    expect(gain('fire_light')).toBeLessThan(gain('fire_heavy'));
    expect(gain('boss_spawn')).toBeGreaterThan(gain('enemy_die_elite'));
    expect(gain('player_die')).toBeGreaterThanOrEqual(gain('boss_spawn'));
  });
});

describe('the trigger tables', () => {
  it('has considered EVERY event kind - a new event must not default to silence', () => {
    // EVENT_NAMES is index-aligned to the kind, so its length IS the number of kinds. This is the
    // test that makes the table total in practice as well as in the type: adding an event to the
    // ring without deciding its sound fails here by name.
    for (let kind = 0; kind < EVENT_NAMES.length; kind++) {
      expect(
        Object.prototype.hasOwnProperty.call(EVENT_SFX, kind),
        `event ${kind} (${EVENT_NAMES[kind]}) has no entry in EVENT_SFX - decide, even if the answer is null`,
      ).toBe(true);
    }
  });

  it('never names a sound the library does not have', () => {
    for (const [kind, id] of Object.entries(EVENT_SFX)) {
      if (id === null) continue;
      expect(SFX_BY_ID.has(id), `event ${kind} names unknown sfx "${id}"`).toBe(true);
    }
    for (const [weapon, id] of Object.entries(FIRE_SFX)) {
      if (id === null) continue;
      expect(SFX_BY_ID.has(id), `weapon ${weapon} names unknown sfx "${id}"`).toBe(true);
    }
    for (const t of UI_TRIGGERS) {
      expect(SFX_BY_ID.has(t.sfx), `ui trigger names unknown sfx "${t.sfx}"`).toBe(true);
    }
  });

  it('has decided what every shipping weapon sounds like', () => {
    for (const def of WEAPON_CATALOG) {
      expect(
        Object.prototype.hasOwnProperty.call(FIRE_SFX, def.id),
        `${def.id} has no entry in FIRE_SFX`,
      ).toBe(true);
    }
  });

  it('leaves the beams out of the per-shot table, because a beam is held rather than fired', () => {
    for (const def of WEAPON_CATALOG) {
      if (def.kind !== 'beam') continue;
      expect(FIRE_SFX[def.id], `${def.id} is a beam and must not fire a per-shot sound`).toBeNull();
    }
  });

  it('grades a blast by its radius, and covers the whole range', () => {
    expect(blastSfxFor(0)).toBe('blast_small');
    expect(blastSfxFor(BLAST_SMALL_MAX)).toBe('blast_small');
    expect(blastSfxFor(BLAST_SMALL_MAX + 1)).toBe('blast_medium');
    expect(blastSfxFor(BLAST_MEDIUM_MAX)).toBe('blast_medium');
    expect(blastSfxFor(BLAST_MEDIUM_MAX + 1)).toBe('blast_large');
    expect(blastSfxFor(9999)).toBe('blast_large');
  });

  it('puts every shipping splash radius into a grade that exists', () => {
    // The thresholds are only right if the guns the game actually ships land where they should, so
    // this walks the catalog rather than trusting the numbers in the comment above them.
    for (const def of WEAPON_CATALOG) {
      const r = def.base.splashRadius;
      if (r <= 0) continue;
      expect(SFX_BY_ID.has(blastSfxFor(r)), `${def.id} splash ${r} grades to a missing clip`).toBe(true);
    }
  });

  it('routes an arrival by what it does, not by what threw it', () => {
    expect(hitSfxFor({ beam: false })).toBe('hit_kinetic');
    expect(hitSfxFor({ beam: true })).toBe('hit_energy');
  });

  it('gives no sound a single weapon to itself, except where declared', () => {
    // THE RULE THE FIRST DRAFT BROKE. Four clips - a flame report, a glob lob, a drone pop and an
    // ignition - each served exactly one gun, and between them they were an eighth of the library.
    // A sound that only one weapon can ever produce is a per-weapon recording wearing a class name.
    //
    // ONE EXCEPTION IS DECLARED, AND DECLARING IT IS THE POINT. `fire_flak` serves only the Flak
    // Cannon because it shares the rotary mount with the Machine Gun: same rate, same silhouette,
    // and with one shared report a player holding both cannot hear which is working. The exemption
    // is a LIST rather than a loosened rule, so the next per-weapon sound has to be added here on
    // purpose and argued for, instead of the rule quietly ceasing to mean anything.
    const ALLOWED_SOLO = new Set(['fire_flak']);

    const users = new Map<string, number>();
    for (const id of Object.values(FIRE_SFX)) {
      if (id === null) continue;
      users.set(id, (users.get(id) ?? 0) + 1);
    }
    for (const [id, n] of users) {
      if (ALLOWED_SOLO.has(id)) continue;
      expect(n, `${id} is fired by exactly one weapon - fold it into a class`).toBeGreaterThan(1);
    }
    // And the exemption must not rot: an entry here that is no longer solo is a stale licence.
    for (const id of ALLOWED_SOLO) {
      expect(users.get(id), `${id} is exempted but not actually solo - drop the exemption`).toBe(1);
    }
  });

  it('separates a ranked death from a regular one', () => {
    expect(deathSfxFor(false)).toBe('enemy_die');
    expect(deathSfxFor(true)).toBe('enemy_die_elite');
  });
});
