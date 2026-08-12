/**
 * `npm run screenshot` - boots the built (or dev) site in Chromium at iPhone dimensions and
 * saves a PNG.
 *
 * There is no Mac and no Xcode in this project, so Safari Web Inspector does not exist as a
 * debugging option. A screenshot from a headless Chromium at 393x852 is the closest thing to
 * "look at the phone" that CI can offer, and it catches the failure that matters most: a blank
 * canvas from the Pixi v8 async-init trap.
 *
 * NEVER run `npx playwright install` here - browsers are preinstalled at /opt/pw-browsers.
 */

import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const DEFAULT_URL = 'http://localhost:4173/';
const DEFAULT_OUT = 'artifacts/screenshot.png';
/** iPhone 14/15 portrait CSS pixels - the target device. */
const VIEWPORT = { width: 393, height: 852 };

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const url = argValue(args, '--url') ?? DEFAULT_URL;
  const out = resolve(argValue(args, '--out') ?? DEFAULT_OUT);
  const waitMs = Number.parseInt(argValue(args, '--wait') ?? '3000', 10);

  const { chromium } = await import('@playwright/test');

  // executablePath is the documented fallback for when the bundled browser lookup fails.
  const launchOptions: { executablePath?: string } = {};
  if (process.env.PLAYWRIGHT_BROWSERS_PATH === undefined) {
    launchOptions.executablePath = '/opt/pw-browsers/chromium';
  }

  const browser = await chromium.launch(launchOptions);
  const page = await browser.newPage({
    viewport: VIEWPORT,
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  });

  const errors: string[] = [];
  page.on('pageerror', (e: Error) => errors.push(e.message));
  page.on('console', (m: { type(): string; text(): string }) => {
    if (m.type() === 'error') errors.push(m.text());
  });

  await page.goto(url, { waitUntil: 'load', timeout: 30_000 });
  await page.waitForTimeout(waitMs);

  await mkdir(dirname(out), { recursive: true });
  await page.screenshot({ path: out });
  await browser.close();

  console.log(`screenshot -> ${out}`);
  if (errors.length > 0) {
    console.error(`page reported ${errors.length} error(s):`);
    for (const e of errors.slice(0, 20)) console.error(`  ${e}`);
    process.exitCode = 1;
  }
}

function argValue(args: readonly string[], key: string): string | undefined {
  const i = args.indexOf(key);
  if (i >= 0 && i + 1 < args.length) return args[i + 1];
  const inline = args.find((a) => a.startsWith(`${key}=`));
  return inline?.slice(key.length + 1);
}

void main();
