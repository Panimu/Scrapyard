/**
 * `npm run scrap` - draws the four scrap piles that stand in the yard, into public/sprites/.
 *
 * WHERE THE ART COMES FROM. Kenney has no junkyard pack, and the search was not a quick one:
 * sci-fi-rts ships rocks, crystals and buildings; top-down-shooter's 524 tiles are floors and
 * walls; itch.io's junkyard tilesets are all 16x16 pixel art, which would look like a different
 * game bolted onto this one. What Kenney DOES have that belongs in a scrapyard is BARRELS - the
 * top-view drums from Top-down Tanks (CC0, vendored under assets/kenney/top-down-tanks) - so those
 * are composited in for real, and the wrecks, plates, girders and tyres around them are drawn.
 *
 * That split is deliberate rather than lazy. A drum is a recognisable object that reads instantly
 * at 60 world units and is exactly the sort of thing Kenney draws well; a crushed car seen from
 * directly above is a shape nobody has a stock sprite for, and drawing it lets it match the mechs
 * it will be standing next to.
 *
 * ---------------------------------------------------------------------------------------------
 * FOUR PILES, ALL THE SAME SIZE, AND WHY THEY ARE ROUND
 * ---------------------------------------------------------------------------------------------
 * The simulation models every pile as ONE CIRCLE (content/scenery.ts) - that is what makes the
 * collision resolve in a handful of instructions inside the movement loop, and what lets a laser
 * test occlusion with a ray-circle intersection rather than a polygon sweep. So the art has to be
 * honest about being a circle: each variant is drawn to fill a nominal radius and nothing pokes
 * meaningfully outside it. A pile with a long girder sticking out would be a pile you could stand
 * inside, and the player would blame the game rather than the sprite.
 *
 * They are drawn at ONE size and scaled per-pile by the renderer, because the sim draws its radius
 * from a range and matching the art to it is one multiply.
 *
 * NEVER run `npx playwright install` here - browsers are preinstalled at /opt/pw-browsers.
 */

import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'public', 'sprites');
const KENNEY = join(ROOT, 'assets', 'kenney', 'top-down-tanks', 'PNG', 'Obstacles');

/**
 * Two pixels per world unit, as the fence and the mechs. The nominal pile is 96 u across, so the
 * canvas is 192 - and the renderer scales from there to whatever radius the sim rolled.
 */
const PX = 2;
const NOMINAL_RADIUS = 96;
const S = NOMINAL_RADIUS * PX;

const DRAW = `(variant, barrels) => {
  const S = ${S}, PX = ${PX};
  const c = document.createElement('canvas');
  c.width = S; c.height = S;
  const g = c.getContext('2d');
  const CX = S / 2, CY = S / 2;
  const R = S / 2;

  const STEEL     = '#6a7078';
  const STEEL_DK  = '#454b53';
  const STEEL_HI  = '#949aa2';
  const RUST      = '#8a4a24';
  const RUST_DEEP = '#5b2f16';
  const RUBBER    = '#26282c';
  const DIRT_DARK = '#2b2419';
  const PAINT = ['#7c4a3a', '#3f5a6b', '#6b6a44', '#5a3f52'];

  let seed = (0x9e3779b9 ^ (variant * 0x85ebca6b)) >>> 0;
  const rnd = () => {
    seed ^= seed << 13; seed >>>= 0;
    seed ^= seed >> 17;
    seed ^= seed << 5;  seed >>>= 0;
    return seed / 4294967296;
  };
  const rr = (a, b) => a + (b - a) * rnd();

  // --- the ground the pile stands on -------------------------------------------------------
  // A dirt scar under everything, and a soft contact shadow. Without the shadow the pile reads as
  // a decal; it is the same trick and the same reason as the fence's inside shade.
  g.save();
  g.beginPath(); g.arc(CX, CY, R * 0.94, 0, 6.284); g.clip();
  const scar = g.createRadialGradient(CX, CY, R * 0.2, CX, CY, R * 0.94);
  scar.addColorStop(0, 'rgba(43,36,25,0.85)');
  scar.addColorStop(0.75, 'rgba(43,36,25,0.45)');
  scar.addColorStop(1, 'rgba(43,36,25,0)');
  g.fillStyle = scar; g.fillRect(0, 0, S, S);
  for (let i = 0; i < 90; i++) {
    const a = rnd() * 6.284, d = Math.sqrt(rnd()) * R * 0.92;
    g.fillStyle = rnd() < 0.5 ? DIRT_DARK : 'rgba(120,98,70,0.35)';
    g.fillRect(CX + Math.cos(a) * d, CY + Math.sin(a) * d, rr(1, 4), rr(1, 3));
  }
  g.restore();

  const shadow = (px, py, w, h, rot) => {
    g.save(); g.translate(px + 2.5, py + 3.5); g.rotate(rot);
    g.fillStyle = 'rgba(0,0,0,0.42)'; g.fillRect(-w / 2, -h / 2, w, h); g.restore();
  };
  const plate = (px, py, w, h, rot, fill, edge) => {
    shadow(px, py, w, h, rot);
    g.save(); g.translate(px, py); g.rotate(rot);
    g.fillStyle = fill; g.fillRect(-w / 2, -h / 2, w, h);
    g.fillStyle = edge ?? STEEL_HI; g.fillRect(-w / 2, -h / 2, w, Math.max(1.5, h * 0.14));
    g.restore();
  };

  // --- variant 0: CRUSHED CARS ---------------------------------------------------------------
  // Flattened bodies stacked askew. Painted panels, because colour is what says "these were cars"
  // from directly above - a grey heap is just a heap.
  if (variant === 0) {
    const cars = [[-0.20, 0.18, 0.30], [0.16, 0.22, -0.55], [-0.06, -0.10, 0.95], [0.14, -0.26, 0.15]];
    for (let i = 0; i < cars.length; i++) {
      const [fx, fy, rot] = cars[i];
      const px = CX + fx * S, py = CY + fy * S;
      const w = R * rr(0.85, 1.05), h = R * rr(0.5, 0.62);
      plate(px, py, w, h, rot, PAINT[i % PAINT.length]);
      // A crushed roof: a darker inset panel, offset, so the body has a top rather than being flat.
      g.save(); g.translate(px, py); g.rotate(rot);
      g.fillStyle = 'rgba(0,0,0,0.30)';
      g.fillRect(-w * 0.28, -h * 0.30, w * 0.5, h * 0.62);
      g.fillStyle = 'rgba(255,255,255,0.10)';
      g.fillRect(-w * 0.42, -h * 0.42, w * 0.18, h * 0.2);
      g.restore();
      // Rust creeping over the join.
      for (let k = 0; k < 5; k++) {
        g.globalAlpha = rr(0.2, 0.5); g.fillStyle = rnd() < 0.5 ? RUST : RUST_DEEP;
        g.beginPath();
        g.ellipse(px + rr(-w * 0.4, w * 0.4), py + rr(-h * 0.4, h * 0.4), rr(3, 9), rr(2, 6), 0, 0, 6.284);
        g.fill();
      }
      g.globalAlpha = 1;
    }
  }

  // --- variant 1: BARREL CLUSTER -------------------------------------------------------------
  // Kenney's drums, on a pallet of drawn plates. Their own shadows are drawn under them because
  // the source sprites have none, and without one they float.
  if (variant === 1) {
    plate(CX, CY + R * 0.10, R * 1.25, R * 0.85, 0.12, STEEL_DK);
    const spots = [[-0.24, -0.10], [0.02, -0.24], [0.24, -0.04], [-0.10, 0.16], [0.18, 0.22], [-0.30, 0.24]];
    for (let i = 0; i < spots.length; i++) {
      const px = CX + spots[i][0] * S, py = CY + spots[i][1] * S;
      const d = R * rr(0.40, 0.50);
      g.beginPath(); g.ellipse(px + 3, py + 4, d / 2, d / 2, 0, 0, 6.284);
      g.fillStyle = 'rgba(0,0,0,0.40)'; g.fill();
      const img = barrels[i % barrels.length];
      g.drawImage(img, px - d / 2, py - d / 2, d, d);
      if (rnd() < 0.55) {
        g.globalAlpha = rr(0.25, 0.5); g.fillStyle = RUST;
        g.beginPath(); g.ellipse(px + rr(-d * 0.2, d * 0.2), py + rr(-d * 0.2, d * 0.2), rr(3, 7), rr(3, 6), 0, 0, 6.284);
        g.fill(); g.globalAlpha = 1;
      }
    }
  }

  // --- variant 2: GIRDER AND SHEET HEAP ------------------------------------------------------
  if (variant === 2) {
    for (let i = 0; i < 9; i++) {
      const a = rnd() * 6.284, d = Math.sqrt(rnd()) * R * 0.5;
      const long = rnd() < 0.5;
      plate(
        CX + Math.cos(a) * d, CY + Math.sin(a) * d,
        long ? R * rr(1.0, 1.35) : R * rr(0.4, 0.7),
        long ? R * rr(0.10, 0.18) : R * rr(0.3, 0.5),
        rnd() * 3.14,
        rnd() < 0.35 ? RUST_DEEP : rnd() < 0.5 ? STEEL : STEEL_DK,
      );
    }
    // A couple of exposed I-beam webs, which is the detail that says girder rather than plank.
    for (let i = 0; i < 3; i++) {
      const a = rnd() * 6.284, d = rnd() * R * 0.4;
      g.save(); g.translate(CX + Math.cos(a) * d, CY + Math.sin(a) * d); g.rotate(rnd() * 3.14);
      g.fillStyle = STEEL_DK; g.fillRect(-R * 0.5, -2, R, 4);
      g.fillStyle = STEEL_HI; g.fillRect(-R * 0.5, -2, R, 1.5);
      g.restore();
    }
  }

  // --- variant 3: TYRES AND RUBBLE -----------------------------------------------------------
  if (variant === 3) {
    for (let i = 0; i < 7; i++) {
      const a = rnd() * 6.284, d = Math.sqrt(rnd()) * R * 0.55;
      const px = CX + Math.cos(a) * d, py = CY + Math.sin(a) * d;
      const rad = R * rr(0.20, 0.30);
      g.beginPath(); g.arc(px + 2, py + 3, rad, 0, 6.284); g.fillStyle = 'rgba(0,0,0,0.40)'; g.fill();
      g.beginPath(); g.arc(px, py, rad, 0, 6.284); g.fillStyle = RUBBER; g.fill();
      g.beginPath(); g.arc(px, py, rad * 0.45, 0, 6.284); g.fillStyle = '#3a3d42'; g.fill();
      // Tread notches, which is all that separates a tyre from a dark disc at this size.
      g.strokeStyle = '#3c4046'; g.lineWidth = 1.5;
      for (let k = 0; k < 8; k++) {
        const t = (k / 8) * 6.284;
        g.beginPath();
        g.moveTo(px + Math.cos(t) * rad * 0.55, py + Math.sin(t) * rad * 0.55);
        g.lineTo(px + Math.cos(t) * rad * 0.95, py + Math.sin(t) * rad * 0.95);
        g.stroke();
      }
    }
    for (let i = 0; i < 10; i++) {
      const a = rnd() * 6.284, d = Math.sqrt(rnd()) * R * 0.8;
      plate(CX + Math.cos(a) * d, CY + Math.sin(a) * d, rr(6, 16), rr(5, 11), rnd() * 3.14,
        rnd() < 0.5 ? RUST_DEEP : STEEL_DK);
    }
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
  const barrelFiles = ['barrelGreen_up.png', 'barrelRed_up.png', 'barrelGrey_up.png'];
  const barrelUris = [];
  for (const f of barrelFiles) {
    const buf = await readFile(join(KENNEY, f));
    barrelUris.push(`data:image/png;base64,${buf.toString('base64')}`);
  }

  const { chromium } = await import('@playwright/test');
  const launchOptions = {};
  const found = resolveChromium();
  if (found !== undefined) launchOptions.executablePath = found;

  const browser = await chromium.launch(launchOptions);
  const page = await browser.newPage();
  await page.goto('about:blank');
  await mkdir(OUT_DIR, { recursive: true });

  // Decode the Kenney drums once, into page scope, so each variant can composite them.
  await page.evaluate(async (uris) => {
    window.__barrels = await Promise.all(
      uris.map(
        (u) =>
          new Promise((ok, fail) => {
            const img = new Image();
            img.onload = () => ok(img);
            img.onerror = fail;
            img.src = u;
          }),
      ),
    );
  }, barrelUris);

  let bytes = 0;
  for (let v = 0; v < 4; v++) {
    const dataUrl = await page.evaluate(`(${DRAW})(${v}, window.__barrels)`);
    const buf = Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
    await writeFile(join(OUT_DIR, `scrap_${v}.png`), buf);
    bytes += buf.length;
    console.log(`  scrap_${v}        ${(buf.length / 1024).toFixed(1)} kB`);
  }

  await browser.close();
  console.log(`\n4 sprites, ${(bytes / 1024).toFixed(0)} kB -> ${OUT_DIR}`);
}

void main();
