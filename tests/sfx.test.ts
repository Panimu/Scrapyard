/**
 * THE SOUND LIBRARY AND ITS WIRING - that every sound exists, and that everything which should
 * make one does.
 *
 * ---------------------------------------------------------------------------------------------
 * THE ONE THAT MATTERS MOST IS THE DISK CHECK
 * ---------------------------------------------------------------------------------------------
 * A catalog naming a clip that is not in `public/sfx/` is a silent hole: nothing throws, nothing
 * logs at build time, and the first person to find out is a player who shot something and heard
 * nothing. The pairing is asserted in BOTH directions - every id has a file, every file has an id
 * - because an orphaned file is a different bug (a rename that only went half way) with the same
 * cause, and it also keeps the deploy from carrying assets nothing can ever play.
 */

import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  PICKUP_KIND_CHEST,
  PICKUP_KIND_CREDIT,
  PICKUP_KIND_DICE,
  PICKUP_KIND_GEM,
  PICKUP_KIND_MAGNET,
  PICKUP_KIND_REPAIR,
  PICKUP_KIND_REPAIR_CROSS,
} from '../src/core/entity/pickupPool.js';
import { SPECIAL_EVENTS, EVENT_SWARM } from '../src/core/content/specialEvents.js';
import { HIT_ENERGY, HIT_INCENDIARY, HIT_SOLID } from '../src/core/systems/damage.js';
import { WEAPON_CATALOG } from '../src/core/content/weaponCatalog.js';
import { SFX_BY_ID, SFX_CATALOG, SFX_LOOPS, type SfxId } from '../src/render/audio/sfxCatalog.js';
import { EV_DRONE_FIRED } from '../src/core/events/ring.js';
import {
  BLAST_MEDIUM_MAX,
  BLAST_SMALL_MAX,
  EVENT_SFX,
  FIRE_SFX,
  UI_TRIGGERS,
  blastSfxFor,
  consumableSfxFor,
  deathSfxFor,
  fireSfxFor,
  hitSfxFor,
  specialEventSfxFor,
} from '../src/render/audio/sfxTriggers.js';

const SFX_DIR = resolve(process.cwd(), 'public/sfx');

describe('the sound library', () => {
  it('has a file for every clip it names, and names every file it has', () => {
    const onDisk = new Set(
      readdirSync(SFX_DIR)
        .filter((f) => f.endsWith('.mp3'))
        .map((f) => f.slice(0, -4)),
    );
    const named = new Set(SFX_CATALOG.map((d) => d.clip));

    const missing = [...named].filter((c) => !onDisk.has(c));
    const orphaned = [...onDisk].filter((f) => !named.has(f));

    // Listed rather than counted: when this fails the names ARE the fix.
    expect(missing, 'catalog names a clip with no file').toEqual([]);
    expect(orphaned, 'public/sfx holds a file nothing can play').toEqual([]);
  });

  it('has no duplicate ids and no duplicate clip keys', () => {
    expect(new Set(SFX_CATALOG.map((d) => d.id)).size).toBe(SFX_CATALOG.length);
    expect(new Set(SFX_CATALOG.map((d) => d.clip)).size).toBe(SFX_CATALOG.length);
  });

  it('names every clip after its own id, so a file can be found from either end', () => {
    for (const d of SFX_CATALOG) expect(d.clip).toBe(d.id);
  });

  it('mixes the horde under the things that matter', () => {
    // The relative numbers are the design; see the gain column. A gem is heard constantly and a
    // boss is heard four times a run, and the mix has to say so.
    const g = (id: SfxId): number => SFX_BY_ID.get(id)!.gain;
    expect(g('pick_gem')).toBeLessThan(g('chest_open'));
    expect(g('die_grunt')).toBeLessThan(g('die_elite'));
    expect(g('die_elite')).toBeLessThan(g('die_boss'));
    expect(g('fire_mg')).toBeLessThan(g('fire_artillery'));
    expect(g('blast_small')).toBeLessThan(g('blast_large'));
    expect(g('fire_drone')).toBeLessThan(g('fire_mg'));
  });

  it('throttles what can repeat, and does not throttle what cannot', () => {
    // A sound that fires many times a second MUST have a floor or a wave-clear is white noise.
    for (const id of ['pick_gem', 'die_grunt', 'hit_bullet', 'fire_mg'] as SfxId[]) {
      expect(SFX_BY_ID.get(id)!.throttleMs, id).toBeGreaterThan(0);
    }
    // A run ends once. A throttle there would be a number nothing can ever reach.
    for (const id of ['run_won', 'run_lost', 'boss_warn', 'level_up'] as SfxId[]) {
      expect(SFX_BY_ID.get(id)!.throttleMs, id).toBe(0);
    }
  });

  it('loops the beams and only the beams', () => {
    expect([...SFX_LOOPS].sort()).toEqual(['fire_laser_l', 'fire_laser_m', 'fire_laser_s']);
  });
});

describe('the trigger tables', () => {
  it('never names a sound the library does not have', () => {
    for (const [kind, id] of Object.entries(EVENT_SFX)) {
      if (id === null) continue;
      expect(SFX_BY_ID.has(id), `event ${kind} -> ${id}`).toBe(true);
    }
    for (const id of Object.values(FIRE_SFX)) expect(SFX_BY_ID.has(id), id).toBe(true);
    for (const t of UI_TRIGGERS) expect(SFX_BY_ID.has(t.id), t.id).toBe(true);
  });

  it('has decided what every shipping weapon sounds like, with no sharing', () => {
    const ids = WEAPON_CATALOG.map((w) => w.id);
    for (const id of ids) expect(FIRE_SFX[id], id).toBeDefined();
    // ONE PER GUN is the whole point of the current library - see the catalog header. A duplicate
    // here would be the old five-class scheme creeping back in one weapon at a time.
    const used = ids.map((id) => FIRE_SFX[id]);
    expect(new Set(used).size, 'two weapons share a firing clip').toBe(ids.length);
  });

  it('gives the three beams their loop, not a one-shot', () => {
    for (const id of ['laser-short', 'laser-medium', 'laser-long'] as const) {
      expect(SFX_BY_ID.get(FIRE_SFX[id])!.loop, id).toBe(true);
    }
    // And nothing else does, or a gun would hold a note.
    for (const w of WEAPON_CATALOG) {
      if (w.id.startsWith('laser-')) continue;
      expect(SFX_BY_ID.get(FIRE_SFX[w.id])!.loop, w.id).toBeUndefined();
    }
  });

  it('can actually reach every firing clip that is not a loop', () => {
    // THE ONE THAT WOULD HAVE CAUGHT THE SILENCE. Every test above passes on a build where the
    // renderer's WEAPON_FIRED case is an unconditional `return` - the tables are all still
    // correct, they are just never consulted. This walks the router instead of the table.
    const heard = new Set<string>();
    for (const w of WEAPON_CATALOG) {
      const id = fireSfxFor(w.id);
      const beam = SFX_BY_ID.get(FIRE_SFX[w.id])!.loop === true;
      if (beam) {
        expect(id, `${w.id} is a beam and must not fire a one-shot`).toBeNull();
        continue;
      }
      expect(id, `${w.id} fires nothing`).not.toBeNull();
      heard.add(id!);
    }
    // Fourteen guns, three of them beams: eleven one-shots, all distinct.
    expect(heard.size).toBe(WEAPON_CATALOG.length - SFX_LOOPS.length);
    // And the drone's clip is in there, reached through its own event kind as well.
    expect(EVENT_SFX[EV_DRONE_FIRED]).toBe('fire_drone');
  });

  it('says nothing for a slot that resolves to no weapon', () => {
    // An empty mount, or a payload from a run that has ended. Silence, never a throw.
    expect(fireSfxFor(undefined)).toBeNull();
  });

  it('grades a blast by its radius, and covers the whole range', () => {
    expect(blastSfxFor(0)).toBe('blast_small');
    expect(blastSfxFor(BLAST_SMALL_MAX)).toBe('blast_small');
    expect(blastSfxFor(BLAST_SMALL_MAX + 1)).toBe('blast_medium');
    expect(blastSfxFor(BLAST_MEDIUM_MAX)).toBe('blast_medium');
    expect(blastSfxFor(BLAST_MEDIUM_MAX + 1)).toBe('blast_large');
    expect(blastSfxFor(1e6)).toBe('blast_large');
  });

  it('puts every shipping splash radius into a grade that exists', () => {
    for (const w of WEAPON_CATALOG) {
      const r = w.base.splashRadius;
      if (r <= 0) continue;
      expect(SFX_BY_ID.has(blastSfxFor(r)), `${w.id} r=${r}`).toBe(true);
    }
  });

  it('routes an arrival by what it does, not by what threw it', () => {
    expect(hitSfxFor(HIT_SOLID)).toBe('hit_bullet');
    expect(hitSfxFor(HIT_ENERGY)).toBe('hit_laser');
    expect(hitSfxFor(HIT_INCENDIARY)).toBe('hit_plasma');
    // Anything unrecognised is solid, so a fourth class added to the sim without a clip is a
    // plain thud rather than silence.
    expect(hitSfxFor(99)).toBe('hit_bullet');
  });

  it('gives every impact class a clip, and every clip a weapon that produces it', () => {
    // The classes are DERIVED from weapon data (see damage.ts), so this is what notices if a
    // retune ever leaves one of the three unreachable - a file nothing can play.
    const produced = new Set<number>([HIT_SOLID]);
    for (const w of WEAPON_CATALOG) {
      if (w.kind === 'beam') continue; // beams push no hit event at all
      if (w.burn !== undefined) produced.add(HIT_INCENDIARY);
      else if (w.slow !== undefined) produced.add(HIT_ENERGY);
    }
    expect([...produced].sort()).toEqual([HIT_SOLID, HIT_ENERGY, HIT_INCENDIARY].sort());
    for (const k of produced) expect(SFX_BY_ID.has(hitSfxFor(k))).toBe(true);
  });

  it('separates a death by rank', () => {
    expect(deathSfxFor('regular')).toBe('die_grunt');
    expect(deathSfxFor('elite')).toBe('die_elite');
    expect(deathSfxFor('boss')).toBe('die_boss');
  });

  it('gives each consumable its own voice, and the two spanner grades one between them', () => {
    expect(consumableSfxFor(PICKUP_KIND_CREDIT)).toBe('pick_credit');
    expect(consumableSfxFor(PICKUP_KIND_MAGNET)).toBe('pick_magnet');
    expect(consumableSfxFor(PICKUP_KIND_DICE)).toBe('pick_dice');
    // One item at two strengths: a player who could hear which one it was would learn to want the
    // loud one, which is a decision the pickup is not supposed to offer.
    expect(consumableSfxFor(PICKUP_KIND_REPAIR)).toBe('pick_repair');
    expect(consumableSfxFor(PICKUP_KIND_REPAIR_CROSS)).toBe('pick_repair');
    // A gem has its own event, and a chest stops the run rather than being walked over.
    expect(consumableSfxFor(PICKUP_KIND_GEM)).toBeNull();
    expect(consumableSfxFor(PICKUP_KIND_CHEST)).toBeNull();
  });

  it('announces the swarm and nothing else', () => {
    expect(specialEventSfxFor(EVENT_SWARM)).toBe('event_swarm');
    for (const e of SPECIAL_EVENTS) {
      if (e.id === EVENT_SWARM) continue;
      expect(specialEventSfxFor(e.id), e.name).toBeNull();
    }
  });
});
