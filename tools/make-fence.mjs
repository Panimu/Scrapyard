/**
 * `npm run fence` - draws the scrapyard's perimeter fence into public/sprites/.
 *
 * WHY THIS IS GENERATED. The rest of the world runs on Kenney CC0 packs, and the fence was looked
 * for there first. It is not in them: sci-fi-rts ships Environment (rocks, crystals, alien trees),
 * Structure (sixteen buildings) and Tile (ground and rivers), and the nearest thing to a barrier in
 * the whole catalog is one L-shaped wall corner that does not tile. The space and robot packs have
 * no terrain at all. So, as with the mechs, it is drawn.
 *
 * ---------------------------------------------------------------------------------------------
 * WHAT MAKES A FENCE READ AS A FENCE FROM DIRECTLY ABOVE
 * ---------------------------------------------------------------------------------------------
 * Almost nothing that makes one read from the side. There is no elevation, no silhouette against
 * the sky, and the panels - the part you actually picture - are foreshortened into a line. Four
 * things carry it instead:
 *
 *   THE SHADOW, WHICH IS THE ONLY HEIGHT CUE THERE IS. A soft dark band on the INSIDE edge is what
 *     says "this stands up" rather than "this is painted on the ground". It is the single most
 *     important stripe in the texture; without it the fence reads as a road marking.
 *   POSTS BREAKING THE LINE. A continuous band is a wall. Regular thicker blocks with the panel
 *     line running between them is a fence, and the rhythm is legible even at a glance.
 *   RHYTHM ALONG the run - corrugation ribs and chain-link mesh - so the eye gets texture in the
 *     direction the fence goes, which is the only direction it has any room in.
 *   MESS AT THE FOOT. A scrapyard fence has drifted junk piled against it. It also does the
 *     texture's structural job: the debris is what hides the tile seam.
 *
 * ---------------------------------------------------------------------------------------------
 * SEAMLESS, AND WHY THE POST IS SPLIT ACROSS THE EDGE
 * ---------------------------------------------------------------------------------------------
 * The strip is tiled end to end along a 6 km fence, so x=0 must meet x=W exactly. Every mark is
 * kept inside its own panel except the boundary post, which is drawn as two halves - one at each
 * end - so the join lands in the middle of a solid block where nothing can be seen to not line up.
 *
 * FOUR DIFFERENT PANELS per tile rather than one repeated: corrugated, chain-link, a rusted-through
 * sheet, and a patched section. The repeat is then 256 world units instead of 64, which is most of
 * a screen width, and the fence stops looking like wallpaper.
 *
 * The strip runs EAST-WEST. The north and south runs use it directly, the east and west runs use
 * it rotated a quarter turn, so one texture covers the whole perimeter.
 *
 * Rendered through headless Chromium's canvas, like the mechs, for antialiased strokes and
 * gradients. The PNGs are checked in, so nobody needs Chromium to build or play the game.
 *
 * NEVER run `npx playwright install` here - browsers are preinstalled at /opt/pw-browsers.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'sprites');

/**
 * TWO PIXELS PER WORLD UNIT, matching the mechs closely enough that nothing looks like it came
 * from a different game. The strip is 256 world units long and 80 deep; of that depth, 16 units
 * sit INSIDE the arena bound (shadow, and the junk drifted against the foot) and 64 outside
 * (structure, then the dead ground beyond).
 * src/render/assets.ts restates these three numbers and must be kept in step with them.
 */
const PX = 2;
const W = 256 * PX;
/**
 * 512 x 256 - BOTH DIMENSIONS POWER OF TWO, and that is a hard requirement rather than tidiness.
 * The strip is drawn as a TilingSprite, which needs REPEAT wrapping, and WebGL1 cannot repeat a
 * non-power-of-two texture at all: it silently samples black. The floor tile is kept out of the
 * atlas for exactly this reason (docs/ASSET_MANIFEST.md gotcha 8).
 *
 * The structure needs only 80 of the 128 world units; the remaining 48 are solid VOID, which is
 * what the outside of the world looks like anyway. So the padding the constraint forces is not
 * waste - it buys 48 more units of dead ground beyond the wire.
 */
const H = 128 * PX;

/** Where the arena's inner face lands in texture space. Everything above this line is inside. */
const INNER = 16 * PX;

const DRAW_FENCE = `() => {
  const c = document.createElement('canvas');
  c.width = ${W}; c.height = ${H};
  const g = c.getContext('2d');

  const W = ${W}, H = ${H}, INNER = ${INNER}, PX = ${PX};
  const PANEL = W / 4;

  // Palette: dead earth, galvanised steel gone grey, and a lot of rust.
  const VOID      = '#151109';
  const DIRT      = '#3b3125';
  const DIRT_DARK = '#2b2419';
  const STEEL     = '#697079';
  const STEEL_DK  = '#454b53';
  const STEEL_HI  = '#8f959d';
  const RUST      = '#8a4a24';
  const RUST_DEEP = '#5b2f16';

  // Deterministic value noise. Math.random would give a different fence on every run and make the
  // checked-in PNG churn in every diff.
  let seed = 0x9e3779b9;
  const rnd = () => {
    seed ^= seed << 13; seed >>>= 0;
    seed ^= seed >> 17;
    seed ^= seed << 5;  seed >>>= 0;
    return seed / 4294967296;
  };

  const rect = (x, y, w, h, fill) => { g.fillStyle = fill; g.fillRect(x, y, w, h); };

  // --- (1) the ground beyond ---------------------------------------------------------------
  // Everything outboard of the structure fades to dead flat nothing. The renderer paints the same
  // VOID over the whole exterior, so this gradient is the SEAM between the yard and the outside
  // and the two colours have to agree exactly.
  const fadeTop = INNER + 30 * PX;
  const fadeEnd = INNER + 64 * PX;
  const beyond = g.createLinearGradient(0, fadeTop, 0, fadeEnd);
  beyond.addColorStop(0, 'rgba(21,17,9,0)');
  beyond.addColorStop(0.5, 'rgba(21,17,9,0.88)');
  beyond.addColorStop(1, VOID);
  rect(0, fadeTop, W, fadeEnd - fadeTop, beyond);
  rect(0, fadeEnd, W, H - fadeEnd, VOID);

  // --- (2) the inside shadow ----------------------------------------------------------------
  // THE HEIGHT CUE. Soft, wide, and entirely inboard, so the yard side of the line is where the
  // fence appears to lean over the ground.
  const shade = g.createLinearGradient(0, 0, 0, INNER + 4 * PX);
  shade.addColorStop(0, 'rgba(0,0,0,0)');
  shade.addColorStop(0.55, 'rgba(0,0,0,0.28)');
  shade.addColorStop(1, 'rgba(0,0,0,0.55)');
  rect(0, 0, W, INNER + 4 * PX, shade);

  // --- (3) the dirt berm the fence stands in ------------------------------------------------
  rect(0, INNER, W, 26 * PX, DIRT);
  const berm = g.createLinearGradient(0, INNER, 0, INNER + 26 * PX);
  berm.addColorStop(0, 'rgba(0,0,0,0.35)');
  berm.addColorStop(0.4, 'rgba(0,0,0,0)');
  rect(0, INNER, W, 26 * PX, berm);
  // Scuffed earth, thinning outward.
  for (let i = 0; i < 260; i++) {
    const x = rnd() * W;
    const y = INNER + rnd() * rnd() * 26 * PX;
    rect(x, y, 1 + rnd() * 3, 1 + rnd(), rnd() < 0.4 ? DIRT_DARK : 'rgba(120,98,70,0.30)');
  }

  // --- (4) the panels ------------------------------------------------------------------------
  // Structure occupies a 16 u band starting 4 u outboard of the bound.
  const PY = INNER + 4 * PX;
  const PH = 16 * PX;

  const corrugated = (x0, w) => {
    rect(x0, PY, w, PH, STEEL_DK);
    for (let x = x0 + 1; x < x0 + w - 1; x += 3 * PX) {
      rect(x, PY + 1, 1.6 * PX, PH - 2, STEEL);
      rect(x + 1.6 * PX, PY + 1, 0.9 * PX, PH - 2, STEEL_DK);
    }
    // Top rail: the outboard lip catches the light and reads as the edge you would grab.
    rect(x0, PY, w, 1.6, STEEL_HI);
  };

  const chainlink = (x0, w) => {
    // Bottom rail and a mesh, transparent enough that the dirt shows through - which is what
    // separates wire from sheet at this size.
    rect(x0, PY + PH - 2.5 * PX, w, 2.5 * PX, STEEL_DK);
    rect(x0, PY, w, 2 * PX, STEEL_DK);
    g.save();
    g.beginPath(); g.rect(x0, PY, w, PH); g.clip();
    g.strokeStyle = 'rgba(168,176,186,0.5)';
    g.lineWidth = 1;
    for (let x = x0 - PH; x < x0 + w + PH; x += 3.2 * PX) {
      g.beginPath(); g.moveTo(x, PY); g.lineTo(x + PH, PY + PH); g.stroke();
      g.beginPath(); g.moveTo(x + PH, PY); g.lineTo(x, PY + PH); g.stroke();
    }
    g.restore();
  };

  const rusted = (x0, w) => {
    corrugated(x0, w);
    // Rust blooms, and one hole eaten right through to the ground behind it.
    for (let i = 0; i < 22; i++) {
      const rx = x0 + rnd() * w;
      const ry = PY + rnd() * PH;
      g.fillStyle = rnd() < 0.5 ? RUST : RUST_DEEP;
      g.globalAlpha = 0.25 + rnd() * 0.5;
      g.beginPath(); g.ellipse(rx, ry, 1.5 * PX + rnd() * 4 * PX, 1 * PX + rnd() * 3 * PX, 0, 0, 6.284); g.fill();
    }
    g.globalAlpha = 1;
    // One section eaten right through. Filled with the DIRT it exposes rather than with black -
    // a hole in a fence shows you the ground on the other side, and at this size a dark disc just
    // reads as a stain someone spilled.
    g.save();
    g.beginPath(); g.ellipse(x0 + w * 0.62, PY + PH * 0.55, 3.5 * PX, 2.6 * PX, 0, 0, 6.284);
    g.fillStyle = DIRT; g.fill();
    g.strokeStyle = RUST_DEEP; g.lineWidth = 1.5; g.stroke();
    g.restore();
  };

  const patched = (x0, w) => {
    chainlink(x0, w);
    // Someone has wired a sheet of scrap over the middle of the mesh, off-square.
    g.save();
    g.translate(x0 + w * 0.5, PY + PH * 0.5);
    g.rotate(0.06);
    rect(-w * 0.28, -PH * 0.46, w * 0.56, PH * 0.92, STEEL_DK);
    for (let x = -w * 0.28; x < w * 0.28; x += 3 * PX) rect(x, -PH * 0.46, 1.4 * PX, PH * 0.92, RUST);
    g.restore();
  };

  const KIND = [corrugated, chainlink, rusted, patched];
  for (let i = 0; i < 4; i++) KIND[i](i * PANEL + 2 * PX, PANEL - 4 * PX);

  // --- (5) posts, including the split one on the seam ----------------------------------------
  const post = (cx) => {
    const w = 4.5 * PX;
    const h = PH + 5 * PX;
    const y = PY - 2.5 * PX;
    rect(cx - w / 2 + 1.5, y + 2, w, h, 'rgba(0,0,0,0.45)'); // its own small shadow
    rect(cx - w / 2, y, w, h, STEEL_DK);
    rect(cx - w / 2, y, w * 0.42, h, STEEL);
    rect(cx - w / 2, y, w, 1.5, STEEL_HI);
    // Rust at the foot, where every real post goes first.
    g.fillStyle = RUST; g.globalAlpha = 0.5;
    rect(cx - w / 2, y + h * 0.62, w, h * 0.38);
    g.globalAlpha = 1;
  };
  for (let i = 1; i < 4; i++) post(i * PANEL);
  post(0); post(W); // the seam post, drawn as two halves that meet when tiled

  // --- (6) junk drifted against the inside ---------------------------------------------------
  // Scrapyard dressing, and it is also what breaks the eye's lock on the 256 u repeat.
  const junk = [
    [0.10, 7, 3.5, RUST_DEEP], [0.13, 4, 2.5, STEEL_DK], [0.31, 5, 3, STEEL_DK],
    [0.47, 9, 4, RUST], [0.52, 5, 2.5, DIRT_DARK], [0.68, 6, 3.5, STEEL_DK],
    [0.71, 4, 2, RUST_DEEP], [0.86, 8, 3.5, RUST_DEEP], [0.90, 5, 3, STEEL_DK],
  ];
  for (const [t, w, h, col] of junk) {
    const x = t * W;
    // INSIDE the bound, at the foot of the panels. Drawn out here rather than in the panel band so
    // it lies ON the yard floor, in the shadow, where drifted scrap actually collects.
    const y = INNER - 10 * PX + rnd() * 8 * PX;
    g.save();
    g.translate(x, y);
    g.rotate((rnd() - 0.5) * 0.9);
    rect(-w * PX / 2 + 1, -h * PX / 2 + 1.5, w * PX, h * PX, 'rgba(0,0,0,0.4)');
    rect(-w * PX / 2, -h * PX / 2, w * PX, h * PX, col);
    rect(-w * PX / 2, -h * PX / 2, w * PX, 1.2, STEEL_HI);
    g.restore();
  }

  return c.toDataURL('image/png');
}`;

/**
 * The corner pillar. Four of these cap the runs so the two strips do not simply cross - a fence
 * whose corner is an X reads as a mistake, and a corner is exactly where a real yard puts its
 * heaviest piece of steel.
 */
const DRAW_POST = `() => {
  const S = ${28 * PX};
  const c = document.createElement('canvas');
  c.width = S; c.height = S;
  const g = c.getContext('2d');
  const PX = ${PX};

  const STEEL = '#697079', STEEL_DK = '#454b53', STEEL_HI = '#8f959d', RUST = '#8a4a24';
  const rect = (x, y, w, h, fill) => { g.fillStyle = fill; g.fillRect(x, y, w, h); };

  const m = 4 * PX;
  rect(m + 2, m + 3, S - 2 * m, S - 2 * m, 'rgba(0,0,0,0.5)');
  rect(m, m, S - 2 * m, S - 2 * m, STEEL_DK);
  rect(m, m, (S - 2 * m) * 0.45, S - 2 * m, STEEL);
  rect(m, m, S - 2 * m, 2, STEEL_HI);
  g.globalAlpha = 0.55;
  rect(m, m + (S - 2 * m) * 0.6, S - 2 * m, (S - 2 * m) * 0.4, RUST);
  g.globalAlpha = 1;
  // Four bolt heads, because a plate this size would have them and they sell the scale.
  g.fillStyle = '#2b3037';
  for (const bx of [0.28, 0.72]) for (const by of [0.28, 0.72]) {
    g.beginPath(); g.arc(m + (S - 2 * m) * bx, m + (S - 2 * m) * by, 1.5 * PX, 0, 6.284); g.fill();
  }
  return c.toDataURL('image/png');
}`;

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
  const launchOptions = {};
  const found = resolveChromium();
  if (found !== undefined) launchOptions.executablePath = found;

  const browser = await chromium.launch(launchOptions);
  const page = await browser.newPage();
  await page.goto('about:blank');
  await mkdir(OUT_DIR, { recursive: true });

  let bytes = 0;
  const write = async (key, dataUrl) => {
    const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
    const buf = Buffer.from(base64, 'base64');
    await writeFile(join(OUT_DIR, `${key}.png`), buf);
    bytes += buf.length;
    console.log(`  ${key.padEnd(16)} ${(buf.length / 1024).toFixed(1)} kB`);
  };

  await write('fence', await page.evaluate(`(${DRAW_FENCE})()`));
  await write('fence_post', await page.evaluate(`(${DRAW_POST})()`));

  await browser.close();
  console.log(`\n2 sprites, ${(bytes / 1024).toFixed(0)} kB -> ${OUT_DIR}`);
}

void main();
