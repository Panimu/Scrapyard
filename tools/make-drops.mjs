/**
 * `npm run drops` - draws the CYBER CHEST and the DICE into public/sprites/.
 *
 * ---------------------------------------------------------------------------------------------
 * THE CHEST HAD NO SPRITE AT ALL
 * ---------------------------------------------------------------------------------------------
 * It was drawn as a single COIN, because the pickup renderer's kind chain ends in "else, a coin"
 * and nothing ever added a branch for it. So the one guaranteed reward in the game - the thing a
 * whole boss fight is for - looked like the smallest drop in the game, and a player who had just
 * killed a Scraplord walked past it.
 *
 * IT IS DRAWN BIGGER THAN THE CONSUMABLES AND LIT FROM INSIDE. The other drops are objects lying
 * in the dirt; this one is a machine that is waiting for you, and the light coming off its screen
 * is the whole of how that reads at 30 units.
 *
 * THE FIRST VERSION WAS A PIRATE CHEST. Lid, corner braces, latch, amber glow through the seam -
 * a perfectly good treasure chest and completely wrong for a thing called a CYBER chest, in a yard
 * where everything else is panelled steel and thin blue light. It is a data vault now: a chamfered
 * slab with a lit SCREEN and circuit traces running out of it, in the blue this game already uses
 * for every system, sight and shield rim.
 *
 * ---------------------------------------------------------------------------------------------
 * THE DICE IS THE RAREST THING A BARREL HOLDS
 * ---------------------------------------------------------------------------------------------
 * It has to be legible as a DIE and not as a crate, at 22 units, on a rust-coloured floor, in the
 * half second a player has while something is chasing them. Three things do that:
 *
 *   AN ISOMETRIC CUBE rather than a flat square. A square with dots on it is a domino; the two
 *     shaded side faces are what make it a die.
 *   PIPS ON TWO FACES. One face of dots reads as a pattern; two faces meeting at a corner read as
 *     an object with a far side.
 *   VIOLET, which is a colour nothing else in the yard uses. Green is the spanner, red is the
 *     magnet, blue is the coins and the systems, amber is the guns and the chest. Violet was the
 *     only slot left, and the rarest drop should be the one you can name from its colour alone.
 *
 * Both share the consumables' 96x96 canvas and their soft under-glow, so a barrel's contents all
 * belong to one set however differently they are drawn.
 *
 * Rendered through headless Chromium's canvas like every other sprite here. The PNGs are checked
 * in, so nobody needs Chromium to build or play.
 *
 * NEVER run `npx playwright install` - browsers are preinstalled at /opt/pw-browsers.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'sprites');

/** The consumables' canvas, so every barrel drop shares one set of proportions. */
const S = 96;

const DRAW = `(what) => {
  const S = ${S};
  const c = document.createElement('canvas');
  c.width = S; c.height = S;
  const g = c.getContext('2d');
  const CX = S / 2, CY = S / 2;

  // The soft under-glow every consumable sits on. It is what stops a drop disappearing against
  // the rust floor, and it is drawn first so nothing else has to know about it.
  const glow = (colour) => {
    const grad = g.createRadialGradient(CX, CY, 2, CX, CY, S * 0.46);
    grad.addColorStop(0, colour);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, S, S);
  };

  const rr = (x, y, w, h, r) => {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  };

  if (what === 'chest') {
    glow('rgba(79, 168, 255, 0.30)');

    // A DATA VAULT, NOT A TREASURE CHEST. The first attempt was a strongbox with a lid and corner
    // braces - which is a chest, but a pirate's, and this thing is called a CYBER chest. Nothing
    // else in the yard is medieval; the mechs are panelled steel and the HUD is thin blue light,
    // so the box has to be made of the same materials as the game it is sitting in.
    //
    // Four things do the work, none of them a lid:
    //   A SCREEN, not a seam. The lit part is a rectangular display with a readout on it, which is
    //     the single strongest "this is a machine" cue at 30 units.
    //   CIRCUIT TRACES running out of it into the casing, ending in pads. Traces are the one
    //     texture that reads as electronics at any size.
    //   A CHAMFERED SLAB with panel lines, rather than a box with a lid line across the middle.
    //   BLUE, and that is the substantive change. Amber is the guns; blue is the SYSTEMS - every
    //     laser sight, every shield rim, every passive icon. A cyber chest is a system.
    const W = 64, H = 50;
    const x0 = CX - W / 2, y0 = CY - H / 2 + 3;
    const ch = 9; // corner chamfer

    g.fillStyle = 'rgba(0,0,0,0.38)';
    g.beginPath();
    g.ellipse(CX, y0 + H + 3, W * 0.46, 5, 0, 0, Math.PI * 2);
    g.fill();

    // The slab: an octagon rather than a rectangle, so the silhouette is not a crate.
    g.beginPath();
    g.moveTo(x0 + ch, y0);
    g.lineTo(x0 + W - ch, y0);
    g.lineTo(x0 + W, y0 + ch);
    g.lineTo(x0 + W, y0 + H - ch);
    g.lineTo(x0 + W - ch, y0 + H);
    g.lineTo(x0 + ch, y0 + H);
    g.lineTo(x0, y0 + H - ch);
    g.lineTo(x0, y0 + ch);
    g.closePath();
    g.fillStyle = '#28313d'; g.fill();
    g.strokeStyle = '#12161d'; g.lineWidth = 3; g.stroke();

    // A lighter top band - light comes from above everywhere else in this game.
    g.save();
    g.clip();
    g.fillStyle = '#333f4e';
    g.fillRect(x0, y0, W, 14);
    g.restore();

    // CIRCUIT TRACES, out of the screen into the casing. Drawn before the screen so the screen
    // sits on top of where they begin.
    g.strokeStyle = '#2f6d9e';
    g.lineWidth = 2;
    g.beginPath();
    for (const sx of [-1, 1]) {
      g.moveTo(CX + sx * 17, CY - 3);
      g.lineTo(CX + sx * 25, CY - 3);
      g.lineTo(CX + sx * 25, CY + 11);
      g.moveTo(CX + sx * 17, CY + 4);
      g.lineTo(CX + sx * 21, CY + 8);
      g.lineTo(CX + sx * 21, CY + 15);
    }
    g.stroke();
    g.fillStyle = '#4fa8ff';
    for (const sx of [-1, 1]) {
      g.beginPath(); g.arc(CX + sx * 25, CY + 12, 2.4, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.arc(CX + sx * 21, CY + 16, 2.4, 0, Math.PI * 2); g.fill();
    }

    // THE SCREEN. Recessed dark, then the lit face, then a readout - three bars of unequal length,
    // which reads as data at a size where actual glyphs would be mud.
    rr(CX - 19, CY - 12, 38, 24, 3);
    g.fillStyle = '#0d1219'; g.fill();
    g.strokeStyle = '#5cb4ff'; g.lineWidth = 2; g.stroke();

    g.fillStyle = 'rgba(92, 180, 255, 0.20)';
    g.fillRect(CX - 17, CY - 10, 34, 20);
    g.fillStyle = '#9ad4ff';
    g.fillRect(CX - 13, CY - 6, 20, 3);
    g.fillRect(CX - 13, CY - 0.5, 26, 3);
    g.fillRect(CX - 13, CY + 5, 14, 3);

    // A hard specular line along the top edge of the screen bezel, which is what makes it read as
    // glass rather than as a hole.
    g.fillStyle = 'rgba(255,255,255,0.55)';
    g.fillRect(CX - 17, CY - 11, 34, 1.5);
  }

  if (what === 'dice') {
    glow('rgba(178, 112, 240, 0.30)');

    // An isometric cube: a top rhombus and two side faces meeting at the near vertical.
    const w = 22;   // half-width of the cube
    const hh = 12;  // half-height of the top rhombus
    const side = 20;
    const topY = CY - 12;

    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.beginPath();
    g.ellipse(CX, topY + hh + side + 4, w * 0.9, 5, 0, 0, Math.PI * 2);
    g.fill();

    const line = '#3a2a55';

    // TOP face, the lightest.
    g.beginPath();
    g.moveTo(CX, topY);
    g.lineTo(CX + w, topY + hh);
    g.lineTo(CX, topY + hh * 2);
    g.lineTo(CX - w, topY + hh);
    g.closePath();
    g.fillStyle = '#c9a4f5'; g.fill();
    g.strokeStyle = line; g.lineWidth = 2.5; g.stroke();

    // LEFT face.
    g.beginPath();
    g.moveTo(CX - w, topY + hh);
    g.lineTo(CX, topY + hh * 2);
    g.lineTo(CX, topY + hh * 2 + side);
    g.lineTo(CX - w, topY + hh + side);
    g.closePath();
    g.fillStyle = '#9a6fdb'; g.fill();
    g.strokeStyle = line; g.lineWidth = 2.5; g.stroke();

    // RIGHT face, darkest - the light is up and to the left, as everywhere else here.
    g.beginPath();
    g.moveTo(CX + w, topY + hh);
    g.lineTo(CX, topY + hh * 2);
    g.lineTo(CX, topY + hh * 2 + side);
    g.lineTo(CX + w, topY + hh + side);
    g.closePath();
    g.fillStyle = '#7a53b0'; g.fill();
    g.strokeStyle = line; g.lineWidth = 2.5; g.stroke();

    // PIPS. Squashed to the faces' own perspective, or they read as stickers.
    const pip = (x, y, rx, ry, rot) => {
      g.beginPath();
      g.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2);
      g.fillStyle = '#fdfaff';
      g.fill();
    };
    // One on top - the face a die shows when it lands, and the simplest thing to read.
    pip(CX, topY + hh, 4.2, 2.6, 0);
    // Three down the left face, on its diagonal.
    for (let i = -1; i <= 1; i++) {
      pip(CX - w * 0.5 + i * 6.5, topY + hh * 1.5 + side * 0.45 + i * 4, 3, 3.6, 0);
    }
    // Two on the right face.
    for (let i = 0; i < 2; i++) {
      pip(CX + w * 0.5 - 3 + i * 7, topY + hh * 1.5 + side * 0.32 + i * 8, 3, 3.6, 0);
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
  const { chromium } = await import('@playwright/test');
  const launchOptions = {};
  const found = resolveChromium();
  if (found !== undefined) launchOptions.executablePath = found;

  const browser = await chromium.launch(launchOptions);
  const page = await browser.newPage();
  await page.goto('about:blank');
  await mkdir(OUT_DIR, { recursive: true });

  for (const [what, file] of [
    ['chest', 'chest.png'],
    ['dice', 'cons_dice.png'],
  ]) {
    const dataUrl = await page.evaluate(`(${DRAW})(${JSON.stringify(what)})`);
    const buf = Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
    await writeFile(join(OUT_DIR, file), buf);
    console.log(`  ${file.padEnd(16)} ${(buf.length / 1024).toFixed(1)} kB -> ${OUT_DIR}`);
  }

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
