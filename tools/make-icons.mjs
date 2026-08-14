/**
 * `npm run icons` - draws one icon per upgrade into public/sprites/, for the Cyber Chest's reels.
 *
 * FOURTEEN SYMBOLS, and they exist because a slot machine has to be read at a glance while it is
 * moving. The level-up card can afford a name and a sentence; a reel cannot, so each of these has
 * to say "Long Laser" or "Ablative Plate" from its silhouette and its colour alone, at 64 pixels,
 * blurred by motion, in the half second it is stationary before the next one lands.
 *
 * ---------------------------------------------------------------------------------------------
 * THE RULES THAT MAKE FOURTEEN ICONS DISTINGUISHABLE
 * ---------------------------------------------------------------------------------------------
 *   COLOUR IS THE CATEGORY, NOT THE ITEM. Weapons are amber and passives are blue, which is the
 *     same split the level-up cards already use (`--accent` against `--accent-sys` in styles.css)
 *     and the same split the chest's payout table cares about. A player reading two amber and one
 *     blue knows what they scored before the number appears.
 *   ONE SHAPE IDEA EACH. Not a small picture of the weapon - a single geometric gesture. Three
 *     lasers that differed only in barrel length would be three identical icons in motion; they
 *     differ in BEAM LENGTH AND COUNT instead, which survives being 64 px and moving.
 *   NOTHING TOUCHES THE EDGE. Each is drawn inside a rounded plate with a margin, so a column of
 *     them reads as a column of tiles rather than as a texture.
 *
 * The three lasers are the hardest case and are worth stating explicitly: short is one stub, medium
 * is one longer bar, long is one full-width bar with a lens flare at the muzzle. Length IS the
 * weapon, which is also true in the game.
 *
 * NEVER run `npx playwright install` here - browsers are preinstalled at /opt/pw-browsers.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'sprites');

/** 128 px, drawn for a reel that shows them at about 64 CSS px on a 3x phone. */
const S = 128;

/**
 * Upgrade id -> icon key. The renderer maps a reel's catalog index through `UpgradeDef.id`, so
 * these strings must match src/core/data/upgrades.ts exactly. A missing one draws nothing rather
 * than throwing, but it is a blank tile on a slot machine, which is worse than an ugly one.
 */
const ICONS = [
  'w-cannon',
  'w-missile-short',
  'w-missile-long',
  'w-machine-gun',
  'w-artillery',
  'w-laser-short',
  'w-laser-medium',
  'w-laser-long',
  'p-range',
  'p-damage',
  'p-rate',
  'p-speed',
  'p-armour',
  'p-shield',
];

const DRAW = `(id) => {
  const S = ${S};
  const c = document.createElement('canvas');
  c.width = S; c.height = S;
  const g = c.getContext('2d');
  const CX = S / 2, CY = S / 2;

  const WEAPON = id.charAt(0) === 'w';
  const KEY      = WEAPON ? '#f0b429' : '#4fa8ff';
  const KEY_DIM  = WEAPON ? '#8a6415' : '#25597f';
  const PLATE    = '#161b23';
  const PLATE_HI = '#232b36';
  const STEEL    = '#8f98a6';

  // --- the tile ------------------------------------------------------------------------------
  const rr = (x, y, w, h, r) => {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  };
  const M = 6;
  rr(M, M, S - M * 2, S - M * 2, 16);
  g.fillStyle = PLATE; g.fill();
  g.strokeStyle = KEY_DIM; g.lineWidth = 3; g.stroke();
  rr(M + 4, M + 4, S - M * 2 - 8, (S - M * 2) * 0.42, 12);
  g.fillStyle = PLATE_HI; g.fill();

  g.lineCap = 'round';
  g.lineJoin = 'round';

  const bar = (x, y, w, h, fill) => { g.fillStyle = fill; g.fillRect(x, y, w, h); };
  const beam = (len, thick) => {
    // A muzzle block on the left, then a beam running right. Length and thickness ARE the weapon.
    bar(26, CY - 9, 14, 18, STEEL);
    g.fillStyle = KEY;
    g.fillRect(40, CY - thick / 2, len, thick);
    g.globalAlpha = 0.35;
    g.fillRect(40, CY - thick, len, thick * 2);
    g.globalAlpha = 1;
  };
  const chevron = (cy, w, t) => {
    g.strokeStyle = KEY; g.lineWidth = t;
    g.beginPath();
    g.moveTo(CX - w, cy + w * 0.55);
    g.lineTo(CX, cy - w * 0.55);
    g.lineTo(CX + w, cy + w * 0.55);
    g.stroke();
  };

  // --- weapons -------------------------------------------------------------------------------
  if (id === 'w-cannon') {
    // One fat shell, nose up. The heaviest single round in the game gets the heaviest single shape.
    g.fillStyle = KEY;
    g.beginPath();
    g.moveTo(CX, 30);
    g.quadraticCurveTo(CX + 17, 52, CX + 17, 74);
    g.lineTo(CX - 17, 74);
    g.quadraticCurveTo(CX - 17, 52, CX, 30);
    g.closePath(); g.fill();
    bar(CX - 19, 74, 38, 12, STEEL);
    bar(CX - 19, 88, 38, 8, KEY_DIM);
  }

  if (id === 'w-missile-short' || id === 'w-missile-long') {
    // TWO squat missiles against ONE long thin one - the same contrast the projectiles themselves
    // are drawn with in assets.ts, so the icon teaches the silhouette the player will see fly.
    const long = id === 'w-missile-long';
    const draw = (x, h, w) => {
      g.fillStyle = KEY;
      g.beginPath();
      g.moveTo(x, CY - h / 2);
      g.lineTo(x + w / 2, CY - h / 2 + w * 0.9);
      g.lineTo(x + w / 2, CY + h / 2);
      g.lineTo(x - w / 2, CY + h / 2);
      g.lineTo(x - w / 2, CY - h / 2 + w * 0.9);
      g.closePath(); g.fill();
      g.fillStyle = STEEL;
      g.fillRect(x - w / 2 - 5, CY + h / 2 - 12, 5, 12);
      g.fillRect(x + w / 2, CY + h / 2 - 12, 5, 12);
    };
    if (long) draw(CX, 62, 20);
    else { draw(CX - 15, 40, 24); draw(CX + 17, 40, 24); }
  }

  if (id === 'w-machine-gun') {
    // A stream. Rounds of decreasing size going right is the only way "many small fast" reads.
    bar(24, CY - 11, 18, 22, STEEL);
    for (let i = 0; i < 5; i++) {
      const r = 8 - i * 1.1;
      g.beginPath(); g.arc(52 + i * 14, CY, r, 0, 6.284);
      g.fillStyle = KEY; g.globalAlpha = 1 - i * 0.13; g.fill();
    }
    g.globalAlpha = 1;
  }

  if (id === 'w-artillery') {
    // The ring the weapon actually draws on the ground, with an arcing shell over it. Nothing else
    // in the game marks its target before it lands, so the ring alone identifies it.
    g.strokeStyle = KEY; g.lineWidth = 5;
    g.beginPath(); g.ellipse(CX, CY + 22, 34, 15, 0, 0, 6.284); g.stroke();
    g.strokeStyle = KEY_DIM; g.lineWidth = 4;
    g.beginPath();
    g.moveTo(CX - 40, CY + 20);
    g.quadraticCurveTo(CX - 6, CY - 46, CX + 22, CY + 8);
    g.stroke();
    g.beginPath(); g.arc(CX + 24, CY + 12, 7, 0, 6.284); g.fillStyle = KEY; g.fill();
  }

  if (id === 'w-laser-short') beam(22, 10);
  if (id === 'w-laser-medium') beam(46, 9);
  if (id === 'w-laser-long') {
    beam(64, 7);
    g.globalAlpha = 0.55;
    g.beginPath(); g.arc(104, CY, 13, 0, 6.284); g.fillStyle = KEY; g.fill();
    g.globalAlpha = 1;
  }

  // --- passives ------------------------------------------------------------------------------
  if (id === 'p-range') {
    // Concentric arcs growing outward: reach.
    g.strokeStyle = KEY;
    for (let i = 0; i < 3; i++) {
      g.lineWidth = 5 - i;
      g.globalAlpha = 1 - i * 0.22;
      g.beginPath(); g.arc(CX - 26, CY, 22 + i * 17, -0.85, 0.85); g.stroke();
    }
    g.globalAlpha = 1;
    g.beginPath(); g.arc(CX - 26, CY, 7, 0, 6.284); g.fillStyle = KEY; g.fill();
  }

  if (id === 'p-damage') chevron(CY + 8, 30, 11);

  if (id === 'p-rate') {
    // Two chevrons: the same gesture as damage, doubled. Rate is damage again, sooner.
    chevron(CY - 6, 27, 9);
    chevron(CY + 26, 27, 9);
  }

  if (id === 'p-speed') {
    // Motion lines behind a wedge. Reads as speed at any size, which is why every game uses it.
    g.fillStyle = KEY;
    g.beginPath();
    g.moveTo(CX + 30, CY);
    g.lineTo(CX - 6, CY - 26);
    g.lineTo(CX - 6, CY + 26);
    g.closePath(); g.fill();
    g.strokeStyle = KEY_DIM; g.lineWidth = 7;
    for (let i = 0; i < 3; i++) {
      const y = CY - 18 + i * 18;
      g.beginPath(); g.moveTo(CX - 44, y); g.lineTo(CX - 18 - i * 4, y); g.stroke();
    }
  }

  if (id === 'p-armour') {
    // A plate, with a bolted seam. Solid and closed, against the shield's open ring.
    g.fillStyle = KEY;
    g.beginPath();
    g.moveTo(CX, 28);
    g.lineTo(CX + 30, 42);
    g.lineTo(CX + 30, 74);
    g.quadraticCurveTo(CX + 30, 94, CX, 104);
    g.quadraticCurveTo(CX - 30, 94, CX - 30, 74);
    g.lineTo(CX - 30, 42);
    g.closePath(); g.fill();
    g.fillStyle = PLATE;
    g.fillRect(CX - 4, 40, 8, 52);
    g.fillStyle = KEY_DIM;
    for (const y of [50, 68, 86]) { g.beginPath(); g.arc(CX, y, 4, 0, 6.284); g.fill(); }
  }

  if (id === 'p-shield') {
    // The rim the game actually draws around the mech, with a gap - a field, not a wall.
    g.strokeStyle = KEY; g.lineWidth = 8;
    g.beginPath(); g.arc(CX, CY, 34, 0.55, 5.73); g.stroke();
    g.globalAlpha = 0.4; g.lineWidth = 15;
    g.beginPath(); g.arc(CX, CY, 34, 0.55, 5.73); g.stroke();
    g.globalAlpha = 1;
    g.beginPath(); g.arc(CX, CY, 12, 0, 6.284); g.fillStyle = STEEL; g.fill();
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
  for (const id of ICONS) {
    const dataUrl = await page.evaluate(`(${DRAW})(${JSON.stringify(id)})`);
    const buf = Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
    await writeFile(join(OUT_DIR, `icon_${id}.png`), buf);
    bytes += buf.length;
  }

  await browser.close();
  console.log(`${ICONS.length} icons, ${(bytes / 1024).toFixed(0)} kB -> ${OUT_DIR}`);
}

void main();
