// Drives the built game with synthetic pointer input and screenshots it.
import { existsSync, readdirSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const root = process.env.PLAYWRIGHT_BROWSERS_PATH ?? '/opt/pw-browsers';
const cands = [];
for (const e of readdirSync(root)) if (e.startsWith('chromium-')) cands.push(join(root, e, 'chrome-linux', 'chrome'));
for (const e of readdirSync(root)) if (e.startsWith('chromium_headless_shell-')) cands.push(join(root, e, 'chrome-linux', 'headless_shell'));
const executablePath = cands.find((p) => existsSync(p));

const { chromium } = await import('@playwright/test');
const browser = await chromium.launch({ executablePath });
const page = await browser.newPage({
  viewport: { width: 393, height: 852 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
});
const errors = [];
page.on('pageerror', (e) => errors.push(String(e.message)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

const url = process.argv[2] ?? 'http://localhost:4173/?start=1&hero=5&seed=ABCDEF&debug=1';
const outDir = '/home/user/Scrapyard/artifacts';
mkdirSync(outDir, { recursive: true });

await page.goto(url, { waitUntil: 'load', timeout: 30000 });
await page.waitForTimeout(1500);

// Circle the thumb around a resting point in the lower-left, like a real player kiting.
const cx = 110, cy = 640;
await page.mouse.move(cx, cy);
await page.mouse.down();

const durationMs = Number(process.argv[3] ?? 60000);
const t0 = Date.now();
let shot = 0;
const shots = new Set((process.argv[4] ?? '8000,25000,55000').split(',').map(Number));
const taken = new Set();

while (Date.now() - t0 < durationMs) {
  const t = (Date.now() - t0) / 1000;
  const ang = t * 0.8;
  await page.mouse.move(cx + Math.cos(ang) * 60, cy + Math.sin(ang) * 60);
  await page.waitForTimeout(50);

  for (const ms of shots) {
    if (!taken.has(ms) && Date.now() - t0 >= ms) {
      taken.add(ms);
      await page.screenshot({ path: `${outDir}/drive_${++shot}.png` });
      console.log(`shot ${shot} at ${ms}ms`);
    }
  }
  // If a level-up card appeared, tap the first one and keep going.
  const card = await page.$('.levelup:not([hidden]) .card:not([hidden])');
  if (card) {
    await page.screenshot({ path: `${outDir}/drive_levelup.png` });
    console.log('levelup screenshot');
    await card.click();
    await page.mouse.move(cx, cy);
    await page.mouse.down();
  }
  if (await page.$('.summary:not([hidden])')) {
    console.log('run ended early at', t.toFixed(1), 's');
    break;
  }
}
await page.mouse.up();
await page.screenshot({ path: `${outDir}/drive_final.png` });
await browser.close();
console.log(errors.length ? `ERRORS:\n${errors.slice(0, 10).join('\n')}` : 'no page errors');
