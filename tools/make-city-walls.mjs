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
 * THE ONE EXCEPTION: the site piles composite in Kenney's `top-down-tanks` barrels and sandbags
 * (assets/kenney/top-down-tanks/PNG/Obstacles/) - already vendored, already flat-vector-with-
 * soft-shading, and already the pack the Scrapyard's own loot drums are cut from. That is the
 * same visual language this file draws in by hand, not an import across the boundary
 * assets/README.md means to hold - it just happens to be a rectangle-with-a-parapet nobody has
 * to draw from scratch. Read as PNG, base64'd into the page, composited alongside the drawn
 * crates and pipes. See `SPRITE_FILES` below for the exact paths.
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
 *      cfence_h/_v       construction barriers, horizontal and vertical runs - posts, a top and
 *                        bottom rail, hazard boards between, a grounding shadow
 *      cpile0..4         material piles inside a site (same collider kind as a fence cell):
 *                        crates, a pipe stack, a barrel cluster, a sandbag wall, a mixed pile
 *      crubble0..3       what a broken fence cell leaves behind - planks, a toppled barrel,
 *                        scattered sandbags, scrap
 *      croofprop0..2     AC unit, vent, skylight - scattered on roof middles by the dressing
 *
 * The floor gets the same wrap-seam check make-floor.mjs runs, because it tiles the whole world
 * and a directional edge would grow a visible grid.
 *
 * NEVER run `npx playwright install` - browsers are preinstalled at /opt/pw-browsers.
 */

import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'public', 'sprites');
const OBSTACLES = join(ROOT, 'assets', 'kenney', 'top-down-tanks', 'PNG', 'Obstacles');

/**
 * The Kenney sprites the pile art composites in, read to base64 in Node (this tool has no server
 * to fetch them from - `make-city-enemies.mjs` stands one up for its model loader, but a handful
 * of small PNGs do not need one) and handed to the page as data URLs. Keyed by the name `DRAW`
 * uses to ask for them.
 */
const SPRITE_FILES = {
  barrelGrey: 'barrelGrey_up.png',
  barrelRed: 'barrelRed_up.png',
  barrelGreen: 'barrelGreen_up.png',
  sandbagBrown: 'sandbagBrown.png',
  sandbagBeige: 'sandbagBeige.png',
};

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
  fenceStripe: '#f2ede2',
  fenceShade: '#b8611e',
  fenceLeg: '#5a5148',
  fencePost: '#4a4640',
  fencePostLit: '#6b655c',
  fenceBase: '#38352f',
  fenceBolt: '#2e2b27',
  shadow: 'rgba(30,28,24,0.28)',
  crate: '#c8a56a',
  crateShade: '#a8854e',
  crateLine: '#8a6c3e',
  pipe: '#8d939e',
  pipeShade: '#6e747f',
  plank: '#b08a55',
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
const DRAW = `async (P, SPRITES) => {
  const T = ${T};
  const FLOOR = ${FLOOR};
  const out = {};

  const mk = (w, h) => {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return [c, c.getContext('2d')];
  };
  // SPRITES arrives as name -> data URL; decode them all up front so the composites below can
  // draw synchronously. One Image per key, same keys as SPRITE_FILES in Node.
  const img = {};
  await Promise.all(Object.entries(SPRITES).map(([k, url]) => new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => { img[k] = im; res(); };
    im.onerror = rej;
    im.src = url;
  })));
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

  // ---- the site fences. Posts with base plates, a top and bottom rail threaded through them,
  // three-tone hazard boards between, and a grounding shadow so the barrier reads as standing on
  // the pavement rather than pasted over it. The vertical variant is its own drawing rather than
  // a rotation, so its posts still sit upright and its shadow still falls the same way as every
  // other object's.
  {
    // Three-tone candy stripe rather than two: a flat orange/white pair reads as a single
    // repeating tile at a glance, and the third, darker tone breaks that up the way a real hazard
    // barrier's worn and fresh boards do.
    const STRIPE = [P.fence, P.fenceStripe, P.fenceShade];
    const drawBoards = (g, x, y, w, h) => {
      g.save();
      g.beginPath();
      g.rect(x, y, w, h);
      g.clip();
      let idx = 0;
      for (let i = -h; i < w + h; i += 22) {
        g.fillStyle = STRIPE[idx % STRIPE.length];
        idx++;
        g.beginPath();
        g.moveTo(x + i, y + h);
        g.lineTo(x + i + h, y);
        g.lineTo(x + i + h + 11, y);
        g.lineTo(x + i + 11, y + h);
        g.fill();
      }
      g.restore();
      // Rails threaded over the boards' ends, so the stripes read as panels held between them
      // rather than as a single stretched image.
      g.fillStyle = P.fencePost;
      g.fillRect(x, y - 3, w, 7);
      g.fillRect(x, y + h - 4, w, 7);
      g.fillStyle = P.fencePostLit;
      g.fillRect(x, y - 3, w, 2);
      g.fillRect(x, y + h - 4, w, 2);
    };
    // One post at each end and one in the middle: a T-wide span on a single pair of end feet used
    // to read as floating boards, because nothing broke up the 128 px run between them. Takes a
    // FOOTPRINT (x, y, w, h) rather than an orientation flag - a horizontal-run fence wants a
    // tall thin post (w < h), a vertical-run fence wants a wide flat one (w > h) crossing its
    // band the other way, and the base plate, bolts and shadow all just scale off whichever shape
    // they are handed. No rotation anywhere, so the shadow never ends up standing on its side.
    const drawPost = (g, x, y, w, h) => {
      g.fillStyle = P.shadow;
      g.beginPath();
      g.ellipse(x + w / 2 + 3, y + h / 2 + 6, w / 2 + 3, h / 2 + 3, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = P.fenceBase;
      g.fillRect(x - 3, y - 3, w + 6, h + 6);
      g.fillStyle = P.fencePost;
      g.fillRect(x, y, w, h);
      g.fillStyle = P.fencePostLit;
      if (w >= h) g.fillRect(x, y, w, Math.min(3, h));
      else g.fillRect(x, y, Math.min(3, w), h);
      g.fillStyle = P.fenceBolt;
      const [bx1, by1, bx2, by2] =
        w >= h ? [x + 6, y + h / 2, x + w - 6, y + h / 2] : [x + w / 2, y + 6, x + w / 2, y + h - 6];
      g.beginPath();
      g.arc(bx1, by1, 2, 0, Math.PI * 2);
      g.fill();
      g.beginPath();
      g.arc(bx2, by2, 2, 0, Math.PI * 2);
      g.fill();
    };
    {
      const [c, g] = mk(T, T);
      g.fillStyle = P.shadow;
      g.beginPath();
      g.ellipse(T / 2 + 3, 87, 66, 9, 0, 0, Math.PI * 2);
      g.fill();
      drawBoards(g, 0, 42, T, 40);
      for (const cx of [10, T / 2, T - 10]) drawPost(g, cx - 5, 36, 10, 48);
      out['cfence_h'] = c.toDataURL('image/png');
    }
    {
      const [c, g] = mk(T, T);
      g.fillStyle = P.shadow;
      g.beginPath();
      g.ellipse(87, T / 2 + 3, 9, 66, 0, 0, Math.PI * 2);
      g.fill();
      drawBoards(g, 44, 0, 40, T);
      for (const cy of [10, T / 2, T - 10]) drawPost(g, 40, cy - 5, 48, 10);
      out['cfence_v'] = c.toDataURL('image/png');
    }
  }

  // ---- the material piles. Crates and a pipe stack, drawn by hand; a barrel cluster, a sandbag
  // revetment and a mixed pile built from Kenney's already-vendored obstacles (see the header) so
  // a site's dressing is not two shapes repeating. Every pile drops a soft shadow first - the same
  // grounding move the fences make, so nothing here reads as pasted onto the pavement rather than
  // standing on it.
  const dropShadow = (g, x, y, w, h) => {
    g.fillStyle = P.shadow;
    g.beginPath();
    g.ellipse(x + w / 2 + 2, y + h / 2 + 4, w / 2, h / 3, 0, 0, Math.PI * 2);
    g.fill();
  };
  const drawImg = (g, im, x, y, w, h) => {
    dropShadow(g, x, y, w, h);
    g.drawImage(im, x, y, w, h);
  };
  {
    const [c, g] = mk(T, T);
    const crate = (x, y, s) => {
      dropShadow(g, x, y, s, s);
      g.fillStyle = P.crate;
      g.fillRect(x, y, s, s);
      g.fillStyle = P.crateShade;
      g.fillRect(x, y + s - 8, s, 8);
      g.fillRect(x + s / 2 - 3, y, 6, s);
      g.strokeStyle = P.crateLine;
      g.lineWidth = 2;
      g.strokeRect(x + 1, y + 1, s - 2, s - 2);
    };
    crate(18, 40, 44);
    crate(64, 48, 40);
    crate(38, 14, 38);
    out['cpile0'] = c.toDataURL('image/png');
  }
  {
    const [c, g] = mk(T, T);
    dropShadow(g, 12, 84, 104, 12);
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
  {
    // Three drums, mixed colours so the site does not read as one vendor's stock delivered in one
    // shade.
    const [c, g] = mk(T, T);
    drawImg(g, img.barrelGrey, 18, 54, 48, 48);
    drawImg(g, img.barrelRed, 58, 62, 42, 42);
    drawImg(g, img.barrelGreen, 42, 18, 46, 46);
    out['cpile2'] = c.toDataURL('image/png');
  }
  {
    // A revetment thrown up in an afternoon: two courses, brown over beige.
    const [c, g] = mk(T, T);
    drawImg(g, img.sandbagBrown, 6, 62, 62, 40);
    drawImg(g, img.sandbagBeige, 52, 66, 62, 40);
    drawImg(g, img.sandbagBrown, 28, 28, 62, 40);
    out['cpile3'] = c.toDataURL('image/png');
  }
  {
    // The mixed pile: one of everything, so a site's dressing does not sort itself into "the
    // barrel block" and "the sandbag block" at a glance.
    const [c, g] = mk(T, T);
    drawImg(g, img.sandbagBeige, 8, 68, 52, 34);
    drawImg(g, img.barrelRed, 58, 56, 42, 42);
    const s = 34;
    dropShadow(g, 32, 12, s, s);
    g.fillStyle = P.crate;
    g.fillRect(32, 12, s, s);
    g.fillStyle = P.crateShade;
    g.fillRect(32, 12 + s - 7, s, 7);
    g.fillRect(32 + s / 2 - 3, 12, 6, s);
    out['cpile4'] = c.toDataURL('image/png');
  }

  // ---- the rubble a broken fence cell leaves. Deliberately low and sparse: the point of breaking
  // a fence is the GAP, and rubble that filled the cell would read as still being in the way.
  // Two hand-drawn plank-and-board tumbles, then a barrel that did not survive and a burst sandbag
  // course - echoing the pile types above so a broken cpile2 or cpile3 leaves something that looks
  // like its own wreckage rather than generic grey debris every time.
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
  {
    const [c, g] = mk(T, T);
    g.fillStyle = P.rubble;
    for (let k = 0; k < 5; k++) {
      const x = 14 + hash(k, 2, 60) * 92;
      const y = 18 + hash(k, 2, 61) * 26;
      g.fillRect(x, y, 10 + hash(k, 2, 62) * 10, 7 + hash(k, 2, 63) * 6);
    }
    drawImg(g, img.barrelGrey, 40, 48, 50, 50);
    out['crubble2'] = c.toDataURL('image/png');
  }
  {
    const [c, g] = mk(T, T);
    g.fillStyle = P.rubble;
    for (let k = 0; k < 6; k++) {
      const x = 20 + hash(k, 3, 60) * 86;
      const y = 76 + hash(k, 3, 61) * 24;
      g.fillRect(x, y, 8 + hash(k, 3, 62) * 10, 6 + hash(k, 3, 63) * 6);
    }
    drawImg(g, img.sandbagBrown, 12, 28, 56, 36);
    drawImg(g, img.sandbagBeige, 56, 40, 48, 32);
    out['crubble3'] = c.toDataURL('image/png');
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

  const sprites = {};
  for (const [key, file] of Object.entries(SPRITE_FILES)) {
    const buf = await readFile(join(OBSTACLES, file));
    sprites[key] = `data:image/png;base64,${buf.toString('base64')}`;
  }

  const tiles = await page.evaluate(`(${DRAW})(${JSON.stringify(PAL)}, ${JSON.stringify(sprites)})`);

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
