/**
 * `npm run citywalls` - draws City Chaos's terrain art into public/sprites/.
 *
 * ---------------------------------------------------------------------------------------------
 * DRAWN PROCEDURALLY, NOT BAKED FROM A PACK - AND WHY
 * ---------------------------------------------------------------------------------------------
 * The city's creatures are baked from Quaternius models (make-city-enemies.mjs), and no free
 * Quaternius set ships top-down building art to stand them on (assets/quaternius/README.md
 * records the gap). Rather than mix in a pack from a different visual language - the exact thing
 * assets/README.md warns against - the terrain is DRAWN here in the same language the bakes come
 * out in: flat colour, soft shading, no keylines. A roof seen from directly above is a rectangle
 * with a parapet; canvas is entirely capable of a rectangle with a parapet.
 *
 * WHAT COMES OUT, all at 128 px per 64-unit cell (2x, matching the Retina convention):
 *
 *      floor_city        512 px seamless pavement - the level's ground, listed in LEVEL_CATALOG
 *      cwall_t<col><row> the 4x4 roof AUTOTILE, same col/row semantics as Mossy's mwall_t set:
 *                        cols 0/1/2 left edge / middle / right edge, col 3 one-cell-wide;
 *                        rows the same vertically. The parapet sits on the outer edges.
 *      cface0..3         building street faces, hung under a roof cell with nothing below it
 *      croad             asphalt, one cell
 *      croad_dash        the painted centre line, a thin strip the dressing lays on road seams
 *      cfence_m<1..15>_<0|1>  construction barriers as a CONNECTIVITY SET - see below
 *      cpile0..3         material piles inside a site (same collider kind as a fence cell)
 *      crubble0/1        what a broken fence cell leaves behind
 *      clitter0..4       site-litter ground decals: oil, spilt aggregate, offcuts, cable, paint
 *      ccone0/1          a traffic cone, standing and knocked over - art-only, nothing collides
 *      croofprop0..2     AC unit, vent, skylight - scattered on roof middles by the dressing
 *
 * THE FENCE IS A MASK SET, NOT AN H PIECE AND A V PIECE. The first version shipped exactly two
 * fence sprites and let the renderer guess, and a corner cell - which has both a horizontal and a
 * vertical neighbour - guessed horizontal: every corner of every site drew as a run that just
 * stopped, visibly detached from the run it was supposed to meet. The scrap paths solved this
 * years ago with `path_1..15`, one piece per N/E/S/W neighbour mask, and this is the same scheme:
 * each piece draws a board arm from the cell centre toward each connected edge, so corners, tees,
 * crossings and ends all have real art. Posts sit ON the joins - cell centres and shared edges -
 * which is also what hides the stripe restart at every tile boundary. Two board variants per
 * mask, picked per cell by the dressing's hash, so a long run is not one image repeating.
 *
 * The floor gets the same wrap-seam check make-floor.mjs runs, because it tiles the whole world
 * and a directional edge would grow a visible grid.
 *
 * NEVER run `npx playwright install` - browsers are preinstalled at /opt/pw-browsers.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'public', 'sprites');

/** Cell tile edge, px. 2x the 64-unit cell, matching the Retina art everywhere else. */
const T = 128;
/** Floor texture edge, px = world units. Same period as the other two floors. */
const FLOOR = 512;

/**
 * The palette, hex, in one place. Flat and slightly warm-greyed, sitting between the asphalt and
 * the toy-bright machines so the horde reads against every surface.
 */
const PAL = {
  pavement: '#b3b0a6',
  pavementSeam: '#a19e94',
  pavementSpeck: '#c2bfb5',
  asphalt: '#43464c',
  asphaltSpeck: '#4b4e55',
  asphaltDark: '#3c3f45',
  lane: '#e3cf58',
  roof: '#7c8494',
  roofSeam: '#737b8b',
  parapet: '#99a1b0',
  parapetShade: '#4a5060',
  face: '#5d6270',
  faceShade: '#4c5160',
  window: '#2c3038',
  windowLit: '#ffd980',
  fence: '#e07b28',
  fenceFade: '#cf873f',
  fenceStripe: '#f2ede2',
  fenceFrame: '#453f38',
  fenceLeg: '#5a5148',
  fencePostLit: '#7d7466',
  crate: '#c8a56a',
  crateShade: '#a8854e',
  pipe: '#8d939e',
  pipeShade: '#6e747f',
  plank: '#b08a55',
  plankLight: '#c29a63',
  gravel: '#96938a',
  gravelLite: '#a7a49a',
  gravelDark: '#807d74',
  rubble: '#7d7a72',
  acBox: '#9aa0aa',
  acShade: '#5d6270',
  vent: '#8d939e',
  skylight: '#9fc4d4',
};

/**
 * All the drawing, as one browser-side function. Deterministic: the only "randomness" is a tiny
 * integer hash, so the output is byte-stable run to run - these files are checked in, and a bake
 * that diffed on every run would make every art commit unreviewable.
 */
const DRAW = `(P) => {
  const T = ${T};
  const FLOOR = ${FLOOR};
  const out = {};

  const mk = (w, h) => {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return [c, c.getContext('2d')];
  };
  // The tiny hash: enough to scatter speckle without a PRNG whose sequence could drift.
  const hash = (x, y, k) => {
    let h = (x * 374761393 + y * 668265263 + k * 2246822519) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };

  // ---- floor_city: pavement panels with sparse speckle. Seams drawn at interior 64s only, so
  // the wrap edges stay plain base colour and the seam check passes by construction.
  {
    const [c, g] = mk(FLOOR, FLOOR);
    g.fillStyle = P.pavement;
    g.fillRect(0, 0, FLOOR, FLOOR);
    g.fillStyle = P.pavementSpeck;
    for (let y = 2; y < FLOOR - 2; y += 3) {
      for (let x = 2; x < FLOOR - 2; x += 3) {
        if (hash(x, y, 1) < 0.06) g.fillRect(x, y, 2, 2);
      }
    }
    g.fillStyle = P.pavementSeam;
    for (let i = 64; i < FLOOR; i += 64) {
      g.fillRect(i - 1, 0, 2, FLOOR);
      g.fillRect(0, i - 1, FLOOR, 2);
    }
    out['floor_city'] = c.toDataURL('image/png');
  }

  // ---- croad: asphalt. Flat noise, no seams - road cells butt against each other and the
  // pavement, and any directional edge would stripe the street.
  {
    const [c, g] = mk(T, T);
    g.fillStyle = P.asphalt;
    g.fillRect(0, 0, T, T);
    for (let y = 0; y < T; y += 2) {
      for (let x = 0; x < T; x += 2) {
        const r = hash(x, y, 2);
        if (r < 0.05) { g.fillStyle = P.asphaltSpeck; g.fillRect(x, y, 2, 2); }
        else if (r < 0.09) { g.fillStyle = P.asphaltDark; g.fillRect(x, y, 2, 2); }
      }
    }
    out['croad'] = c.toDataURL('image/png');
  }

  // ---- croad_dash: the painted line, one cell tall, thin. Laid by the dressing along the road's
  // centre seam; rotated a quarter turn for horizontal streets.
  {
    const [c, g] = mk(16, T);
    g.fillStyle = P.lane;
    g.fillRect(4, 8, 8, 44);
    g.fillRect(4, 76, 8, 44);
    out['croad_dash'] = c.toDataURL('image/png');
  }

  // ---- the roof autotile. col/row 0/1/2 = edge/middle/edge, 3 = the thin single. The parapet
  // is a light outer band with a dark shadow line inside it, on whichever sides are edges.
  {
    const PARA = 14;
    const LINE = 5;
    for (let row = 0; row < 4; row++) {
      for (let col = 0; col < 4; col++) {
        const [c, g] = mk(T, T);
        g.fillStyle = P.roof;
        g.fillRect(0, 0, T, T);
        // Panel seams on the slab, quiet enough to read as texture rather than as a grid.
        g.fillStyle = P.roofSeam;
        g.fillRect(0, 62, T, 3);
        g.fillRect(62, 0, 3, T);

        const left = col === 0 || col === 3;
        const right = col === 2 || col === 3;
        const top = row === 0 || row === 3;
        const bottom = row === 2 || row === 3;
        g.fillStyle = P.parapet;
        if (left) g.fillRect(0, 0, PARA, T);
        if (right) g.fillRect(T - PARA, 0, PARA, T);
        if (top) g.fillRect(0, 0, T, PARA);
        if (bottom) g.fillRect(0, T - PARA, T, PARA);
        g.fillStyle = P.parapetShade;
        if (left) g.fillRect(PARA, 0, LINE, T);
        if (right) g.fillRect(T - PARA - LINE, 0, LINE, T);
        if (top) g.fillRect(0, PARA, T, LINE);
        if (bottom) g.fillRect(0, T - PARA - LINE, T, LINE);
        out['cwall_t' + col + row] = c.toDataURL('image/png');
      }
    }
  }

  // ---- the faces: what a building shows the street on its south side. Four window patterns so
  // a long frontage does not repeat. 72 px tall = 36 units, just over half a cell.
  {
    const FH = 72;
    for (let v = 0; v < 4; v++) {
      const [c, g] = mk(T, FH);
      g.fillStyle = P.face;
      g.fillRect(0, 0, T, FH);
      g.fillStyle = P.faceShade;
      g.fillRect(0, FH - 8, T, 8);
      for (let wy = 0; wy < 2; wy++) {
        for (let wx = 0; wx < 4; wx++) {
          const lit = hash(wx, wy, 40 + v) < 0.28;
          g.fillStyle = lit ? P.windowLit : P.window;
          g.fillRect(10 + wx * 30, 10 + wy * 30, 20, 18);
        }
      }
      out['cface' + v] = c.toDataURL('image/png');
    }
  }

  // ---- the site fences: one piece per N/E/S/W neighbour mask, two board variants each.
  //
  // Every piece is built from the same three moves, in this order:
  //   1. FRAME: the union of the arms, painted 3 px oversize in a dark tone. Because it is drawn
  //      per arm and the boards go OVER it, corners come out with a clean continuous outline for
  //      free - no mitre arithmetic anywhere.
  //   2. BOARDS: the arms clipped and filled with one diagonal stripe pass across the whole tile,
  //      so the stripes of a corner's two arms line up at the elbow like a real mitred barrier.
  //   3. POSTS: one on the cell centre, one half on each connected edge. The neighbouring cell
  //      draws the matching half, so a run reads post-panel-post at 64 u spacing - and the post on
  //      the shared edge is exactly what covers the stripe restart between two baked tiles.
  //
  // An arm reaches from the centre to a connected edge, so a run ENDS at a centre post rather
  // than dead-stopping mid-air, and an end piece needs no special case at all.
  {
    const BAND = 40;
    const B0 = (T - BAND) / 2; // 44: band near edge, both axes - centred, so all arms meet.
    const ARMS = [
      [1, B0, 0, BAND, T / 2], //  N
      [2, T / 2, B0, T / 2, BAND], // E
      [4, B0, T / 2, BAND, T / 2], // S
      [8, 0, B0, T / 2, BAND], //  W
    ];
    const post = (g, cx, cy) => {
      g.fillStyle = P.fenceLeg;
      g.fillRect(cx - 11, cy - 11, 22, 22);
      g.fillStyle = P.fencePostLit;
      g.fillRect(cx - 11, cy - 11, 22, 6);
      g.fillStyle = P.fenceFrame;
      g.fillRect(cx - 3, cy - 2, 6, 6);
    };
    for (let mask = 1; mask < 16; mask++) {
      for (let v = 0; v < 2; v++) {
        const [c, g] = mk(T, T);
        const arms = ARMS.filter(([bit]) => (mask & bit) !== 0);

        g.fillStyle = P.fenceFrame;
        for (const [, x, y, w, h] of arms) g.fillRect(x - 3, y - 3, w + 6, h + 6);

        g.save();
        g.beginPath();
        for (const [, x, y, w, h] of arms) g.rect(x, y, w, h);
        g.clip();
        // Variant 1 is the same barrier a season later: shifted phase, sun-faded orange.
        g.fillStyle = v === 0 ? P.fence : P.fenceFade;
        g.fillRect(0, 0, T, T);
        g.fillStyle = P.fenceStripe;
        for (let i = -T; i < T * 2; i += 32) {
          const x0 = i + v * 16;
          g.beginPath();
          g.moveTo(x0, T + 4);
          g.lineTo(x0 + T + 8, -4);
          g.lineTo(x0 + T + 8 + 14, -4);
          g.lineTo(x0 + 14, T + 4);
          g.fill();
        }
        g.restore();

        for (const [bit] of arms) {
          if (bit === 1) post(g, T / 2, 0);
          if (bit === 2) post(g, T, T / 2);
          if (bit === 4) post(g, T / 2, T);
          if (bit === 8) post(g, 0, T / 2);
        }
        post(g, T / 2, T / 2);

        out['cfence_m' + mask + '_' + v] = c.toDataURL('image/png');
      }
    }
  }

  // ---- the material piles. Crates, and a pipe stack: things a construction site would hold and
  // a shell would knock apart.
  {
    const [c, g] = mk(T, T);
    const crate = (x, y, s) => {
      g.fillStyle = P.crate;
      g.fillRect(x, y, s, s);
      g.fillStyle = P.crateShade;
      g.fillRect(x, y + s - 8, s, 8);
      g.fillRect(x + s / 2 - 3, y, 6, s);
    };
    crate(18, 40, 44);
    crate(64, 48, 40);
    crate(38, 14, 38);
    out['cpile0'] = c.toDataURL('image/png');
  }
  {
    const [c, g] = mk(T, T);
    g.fillStyle = P.plank;
    g.fillRect(12, 84, 104, 12);
    for (const [x, y] of [[34, 58], [62, 58], [48, 34]]) {
      g.fillStyle = P.pipe;
      g.beginPath();
      g.arc(x + 14, y + 14, 15, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = P.pipeShade;
      g.beginPath();
      g.arc(x + 14, y + 14, 8, 0, Math.PI * 2);
      g.fill();
    }
    out['cpile1'] = c.toDataURL('image/png');
  }

  // ---- cpile2: a stack of planks on two bearers, the lumber the fences are built from. Each
  // course is jittered a couple of pixels by the hash so the stack reads as thrown together by a
  // crew, not extruded.
  {
    const [c, g] = mk(T, T);
    g.fillStyle = P.fenceLeg;
    g.fillRect(24, 88, 16, 12);
    g.fillRect(88, 88, 16, 12);
    for (let i = 0; i < 5; i++) {
      const x = 12 + Math.floor(hash(i, 0, 70) * 10);
      const y = 82 - i * 11;
      g.fillStyle = i % 2 === 0 ? P.plank : P.plankLight;
      g.fillRect(x, y, 98, 10);
      g.fillStyle = P.crateShade;
      g.fillRect(x, y + 8, 98, 2);
    }
    out['cpile2'] = c.toDataURL('image/png');
  }

  // ---- cpile3: a heap of aggregate. Two stacked ellipses and speckle in three greys - the one
  // pile with no straight edge on it, which is what stops a site reading as a warehouse of boxes.
  {
    const [c, g] = mk(T, T);
    g.fillStyle = P.gravelDark;
    g.beginPath();
    g.ellipse(64, 74, 44, 28, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = P.gravel;
    g.beginPath();
    g.ellipse(62, 68, 38, 23, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = P.gravelLite;
    g.beginPath();
    g.ellipse(56, 60, 24, 14, 0, 0, Math.PI * 2);
    g.fill();
    for (let k = 0; k < 46; k++) {
      const a = hash(k, 1, 71) * Math.PI * 2;
      const r = Math.sqrt(hash(k, 2, 72));
      const x = 62 + Math.cos(a) * r * 36;
      const y = 68 + Math.sin(a) * r * 21;
      const t = hash(k, 3, 73);
      g.fillStyle = t < 0.33 ? P.gravelDark : t < 0.66 ? P.gravelLite : P.rubble;
      g.fillRect(x, y, 3, 3);
    }
    out['cpile3'] = c.toDataURL('image/png');
  }

  // ---- the rubble a broken fence cell leaves. Planks and grey debris, deliberately low and
  // sparse: the point of breaking a fence is the GAP, and rubble that filled the cell would read
  // as still being in the way.
  for (let v = 0; v < 2; v++) {
    const [c, g] = mk(T, T);
    g.fillStyle = P.rubble;
    for (let k = 0; k < 7; k++) {
      const x = 16 + hash(k, v, 60) * 90;
      const y = 24 + hash(k, v, 61) * 80;
      g.fillRect(x, y, 10 + hash(k, v, 62) * 12, 8 + hash(k, v, 63) * 8);
    }
    g.save();
    g.translate(T / 2, T / 2);
    g.rotate(v === 0 ? 0.35 : -0.5);
    g.fillStyle = P.plank;
    g.fillRect(-44, -8, 88, 12);
    g.fillStyle = P.fence;
    g.fillRect(-30, 6, 52, 10);
    g.restore();
    out['crubble' + v] = c.toDataURL('image/png');
  }

  // ---- site litter. What a working construction site actually looks like from above: not the
  // stock (that is the piles) but the MESS - stains, spills, offcuts, markings. Ground decals,
  // drawn by the dressing UNDER the fences and piles, scattered only over construction blocks.
  // 64 px canvases like the roof props; the dressing sizes them well under a cell so they read
  // as texture on the ground rather than as objects standing on it.
  {
    // clitter0: an oil stain. Two overlapping translucent blotches - the one litter piece with no
    // hard edge anywhere, which is what makes it read as soaked in rather than dropped on.
    const [c, g] = mk(64, 64);
    g.fillStyle = 'rgba(40, 38, 34, 0.30)';
    g.beginPath();
    g.ellipse(30, 34, 22, 16, 0.4, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = 'rgba(40, 38, 34, 0.35)';
    g.beginPath();
    g.ellipse(40, 26, 12, 9, -0.3, 0, Math.PI * 2);
    g.fill();
    out['clitter0'] = c.toDataURL('image/png');
  }
  {
    // clitter1: a spill of aggregate, the heap's own material trodden about.
    const [c, g] = mk(64, 64);
    for (let k = 0; k < 26; k++) {
      const a = hash(k, 5, 80) * Math.PI * 2;
      const r = Math.sqrt(hash(k, 6, 81)) * 24;
      const t = hash(k, 7, 82);
      g.fillStyle = t < 0.4 ? P.gravelDark : t < 0.75 ? P.gravel : P.gravelLite;
      g.fillRect(32 + Math.cos(a) * r, 32 + Math.sin(a) * r * 0.7, 3, 3);
    }
    out['clitter1'] = c.toDataURL('image/png');
  }
  {
    // clitter2: two plank offcuts, crossed the way thrown things land.
    const [c, g] = mk(64, 64);
    g.save();
    g.translate(30, 34);
    g.rotate(0.5);
    g.fillStyle = P.plank;
    g.fillRect(-20, -5, 40, 9);
    g.restore();
    g.save();
    g.translate(36, 30);
    g.rotate(-0.25);
    g.fillStyle = P.plankLight;
    g.fillRect(-16, -4, 34, 8);
    g.restore();
    out['clitter2'] = c.toDataURL('image/png');
  }
  {
    // clitter3: a coil of cable, dropped flat.
    const [c, g] = mk(64, 64);
    g.strokeStyle = P.fenceFrame;
    g.lineWidth = 5;
    g.beginPath();
    g.ellipse(32, 33, 15, 12, 0.2, 0, Math.PI * 2);
    g.stroke();
    g.lineWidth = 4;
    g.beginPath();
    g.ellipse(33, 31, 10, 8, -0.3, 0, Math.PI * 2);
    g.stroke();
    // The loose end, running off the coil.
    g.beginPath();
    g.moveTo(45, 40);
    g.quadraticCurveTo(56, 44, 58, 52);
    g.stroke();
    out['clitter3'] = c.toDataURL('image/png');
  }
  {
    // clitter4: surveyor's spray marks - a bar and a cross in site orange, the thing crews paint
    // on the ground everywhere and nobody else ever draws.
    const [c, g] = mk(64, 64);
    g.strokeStyle = P.fence;
    g.globalAlpha = 0.75;
    g.lineWidth = 5;
    g.beginPath();
    g.moveTo(12, 40);
    g.lineTo(44, 36);
    g.stroke();
    g.beginPath();
    g.moveTo(44, 20);
    g.lineTo(56, 32);
    g.moveTo(56, 20);
    g.lineTo(44, 32);
    g.stroke();
    g.globalAlpha = 1;
    out['clitter4'] = c.toDataURL('image/png');
  }

  // ---- the cones. The one piece of FOREGROUND litter - a thing standing on the site rather than
  // soaked into it - so it gets the fence's own orange and a white band to sit in the same family.
  // Two states, upright and knocked over, because a site where every cone is standing has never
  // had a vehicle on it.
  {
    const [c, g] = mk(64, 64);
    g.fillStyle = 'rgba(30, 28, 24, 0.25)';
    g.beginPath();
    g.ellipse(34, 46, 15, 6, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = P.fence;
    g.fillRect(18, 40, 30, 8); // base plate
    g.beginPath(); // the cone seen from above-ish: concentric squares
    g.moveTo(24, 42);
    g.lineTo(42, 42);
    g.lineTo(37, 22);
    g.lineTo(29, 22);
    g.fill();
    g.fillStyle = P.fenceStripe;
    g.fillRect(27, 30, 12, 6);
    g.fillStyle = P.fenceFade;
    g.fillRect(30, 18, 6, 6); // tip
    out['ccone0'] = c.toDataURL('image/png');
  }
  {
    const [c, g] = mk(64, 64);
    g.fillStyle = 'rgba(30, 28, 24, 0.25)';
    g.beginPath();
    g.ellipse(33, 42, 20, 6, 0, 0, Math.PI * 2);
    g.fill();
    g.save();
    g.translate(32, 36);
    g.rotate(1.35);
    g.fillStyle = P.fence;
    g.fillRect(-15, -4, 30, 8);
    g.beginPath();
    g.moveTo(-9, -6);
    g.lineTo(-9, 6);
    g.lineTo(-30, 3);
    g.lineTo(-30, -3);
    g.fill();
    g.fillStyle = P.fenceStripe;
    g.fillRect(-22, -4, 6, 8);
    g.restore();
    out['ccone1'] = c.toDataURL('image/png');
  }

  // ---- roof props. Small, and drawn once each: variety comes from which roofs get which prop,
  // decided by the dressing's cell hash.
  {
    const [c, g] = mk(64, 64);
    g.fillStyle = P.acBox;
    g.fillRect(8, 10, 48, 44);
    g.fillStyle = P.acShade;
    g.fillRect(8, 46, 48, 8);
    g.beginPath();
    g.arc(32, 30, 14, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = P.acBox;
    g.beginPath();
    g.arc(32, 30, 5, 0, Math.PI * 2);
    g.fill();
    out['croofprop0'] = c.toDataURL('image/png');
  }
  {
    const [c, g] = mk(64, 64);
    g.fillStyle = P.vent;
    g.beginPath();
    g.arc(32, 32, 16, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = P.pipeShade;
    g.beginPath();
    g.arc(32, 32, 9, 0, Math.PI * 2);
    g.fill();
    out['croofprop1'] = c.toDataURL('image/png');
  }
  {
    const [c, g] = mk(64, 64);
    g.fillStyle = P.skylight;
    g.fillRect(10, 14, 44, 36);
    g.fillStyle = 'rgba(255,255,255,0.5)';
    g.beginPath();
    g.moveTo(14, 46);
    g.lineTo(34, 18);
    g.lineTo(44, 18);
    g.lineTo(24, 46);
    g.fill();
    out['croofprop2'] = c.toDataURL('image/png');
  }

  return out;
}`;

/** The same wrap check make-floor.mjs runs, for the same reason. */
const SEAM_FN = `(url, S) => new Promise((res) => {
  const im = new Image();
  im.onload = () => {
    const c = document.createElement('canvas');
    c.width = S; c.height = S;
    const g = c.getContext('2d');
    g.drawImage(im, 0, 0);
    const d = g.getImageData(0, 0, S, S).data;
    const at = (x, y) => (y * S + x) * 4;
    let worstX = 0, worstY = 0;
    for (let i = 0; i < S; i++) {
      for (let ch = 0; ch < 3; ch++) {
        worstX = Math.max(worstX, Math.abs(d[at(0, i) + ch] - d[at(S - 1, i) + ch]));
        worstY = Math.max(worstY, Math.abs(d[at(i, 0) + ch] - d[at(i, S - 1) + ch]));
      }
    }
    res({ worstX, worstY });
  };
  im.src = url;
})`;

function resolveChromium() {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH ?? '/opt/pw-browsers';
  if (!existsSync(root)) return undefined;
  const candidates = [];
  for (const entry of readdirSync(root)) {
    if (entry.startsWith('chromium-')) candidates.push(join(root, entry, 'chrome-linux', 'chrome'));
  }
  for (const entry of readdirSync(root)) {
    if (entry.startsWith('chromium_headless_shell-')) {
      candidates.push(join(root, entry, 'chrome-linux', 'headless_shell'));
    }
  }
  return candidates.find((p) => existsSync(p));
}

async function main() {
  const { chromium } = await import('@playwright/test');
  const found = resolveChromium();
  const browser = await chromium.launch(found !== undefined ? { executablePath: found } : {});
  const page = await browser.newPage();
  await page.goto('about:blank');
  await mkdir(OUT_DIR, { recursive: true });

  const tiles = await page.evaluate(`(${DRAW})(${JSON.stringify(PAL)})`);

  const seam = await page.evaluate(`(${SEAM_FN})(${JSON.stringify(tiles.floor_city)}, ${FLOOR})`);
  if (seam.worstX > 0 || seam.worstY > 0) {
    throw new Error(`floor_city does not wrap: worst edge delta x ${seam.worstX} y ${seam.worstY}`);
  }

  let bytes = 0;
  for (const [key, uri] of Object.entries(tiles)) {
    const buf = Buffer.from(uri.slice(uri.indexOf(',') + 1), 'base64');
    await writeFile(join(OUT_DIR, `${key}.png`), buf);
    bytes += buf.length;
  }
  console.log(
    `  ${Object.keys(tiles).length} city tiles, ${(bytes / 1024).toFixed(1)} kB -> public/sprites/  (floor seam x 0 y 0)`,
  );

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
