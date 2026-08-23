/**
 * `npm run titlefont` - draws the title screen's wordmark and subtitle into public/sprites/.
 *
 * THE ONE PLACE THE GAME DELIBERATELY DOES NOT USE ITS OWN FONT. `Font.cs` on the C# side (and
 * every screen in the web build's own body copy) is a 5x7 pixel grid, chosen so the interface
 * reads as part of the same picture as the pixel-art sprites around it - see the remarks on
 * `Font` for why a loaded typeface was rejected for THAT job.
 *
 * The title wordmark is not that job. `SCRAPYARD` / `SURVIVORS` never carry the CSS stylesheet's
 * own font declaration - `.title__word` and `.title__sub` inherit the page root's
 * `-apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif` - which means the web
 * build's actual logotype is whatever smooth, heavy system UI face the player's OS supplies, not a
 * pixel font at all. A port that put the pixel font there instead was not simplifying the web
 * build's look, it was showing a different one.
 *
 * SO THIS BAKES THE TWO LINES AS IMAGES, the same way every other piece of art in this project is
 * generated rather than loaded at runtime - through headless Chromium's canvas, checked into
 * public/sprites/ as PNGs `Sprites.Get` already knows how to load. That sidesteps every reason
 * `Font.cs` gives for not loading a typeface: nothing is vendored (no font file enters the
 * repository, no licence to track), nothing is required at runtime (the two strings are baked
 * once, not read from a live font at draw time), and the output is exactly two small textures
 * rather than a whole rendering pipeline.
 *
 * BAKED WHITE, TINTED AT DRAW TIME. Both PNGs are pure white glyphs on transparent pixels, the
 * same convention the chassis silhouettes use, so `SpriteBatch.Draw`'s own colour multiply is
 * what makes SCRAPYARD ink-white and SURVIVORS accent-gold - one asset, whatever colour the
 * screen wants this build.
 *
 * RENDERED AT ROUGHLY 3x THE CSS PIXEL SIZE, well past what the title ever needs on screen, so
 * scaling down (or up, on a very tall window) through linear filtering stays smooth rather than
 * showing the render's own pixel grid. THE TITLE SCREEN'S OWN DRAW CALL SWITCHES SAMPLER STATES
 * for exactly these two textures - everything else in the game samples POINT, on purpose, to keep
 * pixel art crisp; these two are the one exception, because linear filtering IS the point here.
 *
 * NEVER run `npx playwright install` here. On the Linux sandbox, browsers are preinstalled at
 * /opt/pw-browsers; on a Windows box without that path, this falls back to the system Chrome
 * install instead of downloading one.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'sprites');

// THE EXACT CSS, copied rather than approximated: `.title__word` / `.title__sub` in
// src/ui/styles.css, and the root font stack from the `:root` rule above them. A value here that
// drifts from that stylesheet is a title that quietly stops matching the web build again.
const FONT_STACK = `-apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif`;
const SCALE = 3; // baked well above the CSS px size; see file header.

const LINES = [
  { key: 'title_word', text: 'SCRAPYARD', weight: 800, cssPx: 62, letterSpacingEm: 0.02 },
  { key: 'title_sub', text: 'SURVIVORS', weight: 700, cssPx: 27, letterSpacingEm: 0.34 },
];

// Runs INSIDE the page via page.evaluate - no access to anything above this line.
const DRAW = String(function draw(text, weight, px, letterSpacingEm, fontStack) {
  const measure = document.createElement('canvas').getContext('2d');
  measure.font = `${weight} ${px}px ${fontStack}`;
  measure.letterSpacing = `${letterSpacingEm}em`;
  measure.textBaseline = 'alphabetic';
  const m = measure.measureText(text);

  // TextMetrics' own bounding box, not the font's nominal ascent/descent: the glyphs actually
  // drawn are what has to fit, and an all-caps word has no descenders to budget space for that
  // would otherwise pad the baked image on one side.
  const pad = Math.ceil(px * 0.08); // a few px of antialiasing bleed room
  const w = Math.ceil(m.actualBoundingBoxLeft + m.actualBoundingBoxRight) + pad * 2;
  const h = Math.ceil(m.actualBoundingBoxAscent + m.actualBoundingBoxDescent) + pad * 2;

  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  g.font = `${weight} ${px}px ${fontStack}`;
  g.letterSpacing = `${letterSpacingEm}em`;
  g.textBaseline = 'alphabetic';
  g.fillStyle = '#ffffff';
  g.fillText(text, pad + m.actualBoundingBoxLeft, pad + m.actualBoundingBoxAscent);

  return c.toDataURL('image/png');
});

function resolveChromium() {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH ?? '/opt/pw-browsers';
  if (existsSync(root)) {
    const candidates = [];
    for (const entry of readdirSync(root)) {
      if (entry.startsWith('chromium-')) candidates.push(join(root, entry, 'chrome-linux', 'chrome'));
    }
    for (const entry of readdirSync(root)) {
      if (entry.startsWith('chromium_headless_shell-')) {
        candidates.push(join(root, entry, 'chrome-linux', 'headless_shell'));
      }
    }
    const found = candidates.find((p) => existsSync(p));
    if (found !== undefined) return found;
  }

  // NO SANDBOX BROWSER HERE: a Windows dev box has no /opt/pw-browsers and this project does not
  // run `playwright install` to get one. The already-installed system Chrome is a perfectly good
  // headless renderer and needs nothing downloaded.
  const windowsCandidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ];
  return windowsCandidates.find((p) => existsSync(p));
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
  for (const line of LINES) {
    const px = line.cssPx * SCALE;
    const args = [
      JSON.stringify(line.text),
      String(line.weight),
      String(px),
      String(line.letterSpacingEm),
      JSON.stringify(FONT_STACK),
    ].join(', ');
    const dataUrl = await page.evaluate(`(${DRAW})(${args})`);
    const buf = Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
    await writeFile(join(OUT_DIR, `${line.key}.png`), buf);
    bytes += buf.length;
    console.log(`  ${line.key.padEnd(12)} "${line.text}" at ${px}px  ${(buf.length / 1024).toFixed(1)} kB`);
  }

  await browser.close();
  console.log(`\n${LINES.length} title images, ${(bytes / 1024).toFixed(0)} kB -> ${OUT_DIR}`);
}

void main();
