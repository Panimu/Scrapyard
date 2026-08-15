/**
 * `npm run drone` - draws the drone into public/sprites/.
 *
 * ---------------------------------------------------------------------------------------------
 * WHY IT IS CIRCULAR
 * ---------------------------------------------------------------------------------------------
 * A drone was shipped wearing the MISSILE sprite, tinted, as a stand-in. That was wrong in a
 * specific way rather than merely ugly: a missile is a long thin thing with a nose, so the eye
 * reads it as travelling in the direction it points - and a drone spends most of its life ORBITING,
 * which means its heading swings through a full circle every three seconds. An arrowhead spinning
 * on the spot looks like a bug in the renderer.
 *
 * A disc has no nose. It reads the same at every angle, which is exactly right for something whose
 * facing is not information, and it is instantly separable from the mechs (rectangular hulls) and
 * from the horde (upright figures) at the size this is drawn.
 *
 * ---------------------------------------------------------------------------------------------
 * WHAT MAKES A DISC READ AS A MACHINE FROM DIRECTLY ABOVE
 * ---------------------------------------------------------------------------------------------
 * Four things, in order of how much they carry:
 *
 *   ROTOR DISCS AT THE CORNERS. The single strongest "this flies" cue there is. Drawn as pale
 *     translucent circles - a spinning blade IS a blur from above, and drawing blades instead
 *     would alias into noise at 26 px.
 *   A BRIGHT LENS AT THE CENTRE, in the game's own system blue. It gives the shape a middle to
 *     look at, and it is the one part that says which of the yard's machines this belongs to.
 *   A HARD RIM. The chassis and the horde both have crisp silhouettes; a soft-edged disc would
 *     read as an effect rather than as an object.
 *   A DROP SHADOW UNDER IT, offset. Nothing else in this game floats, and the shadow is the whole
 *     of how a player is told this one does.
 *
 * ---------------------------------------------------------------------------------------------
 * TWO PIXELS PER WORLD UNIT, matching the mechs and the fence
 * ---------------------------------------------------------------------------------------------
 * The drone is 13 world units across, so the source is 26 px plus room for the rotors and the
 * shadow. src/render/assets.ts restates the drawn size and must be kept in step.
 *
 * Rendered through headless Chromium's canvas like every other sprite here. The PNG is checked in,
 * so nobody needs Chromium to build or play.
 *
 * NEVER run `npx playwright install` - browsers are preinstalled at /opt/pw-browsers.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'sprites');

const DRAW_DRONE = () => {
  const S = 64; // source px, 2 per world unit plus margin for rotors and shadow
  const c = document.createElement('canvas');
  c.width = S;
  c.height = S;
  const g = c.getContext('2d');

  const cx = S / 2;
  const cy = S / 2;
  const body = 13; // body radius, px
  const arm = 17; // rotor centre distance from the middle
  const rotor = 8.5;

  // ---- shadow: the only thing that says this is off the ground -----------------------------
  g.save();
  g.globalAlpha = 0.28;
  g.fillStyle = '#000000';
  g.beginPath();
  g.ellipse(cx + 2.5, cy + 4, body * 0.95, body * 0.8, 0, 0, Math.PI * 2);
  g.fill();
  g.restore();

  // ---- rotors: pale blurred discs, drawn UNDER the body so the arms come out of the hull ----
  const rotorAt = (ax, ay) => {
    const grd = g.createRadialGradient(ax, ay, 0, ax, ay, rotor);
    grd.addColorStop(0, 'rgba(210, 226, 245, 0.10)');
    grd.addColorStop(0.72, 'rgba(210, 226, 245, 0.26)');
    grd.addColorStop(1, 'rgba(210, 226, 245, 0)');
    g.fillStyle = grd;
    g.beginPath();
    g.arc(ax, ay, rotor, 0, Math.PI * 2);
    g.fill();
    // A faint hard edge on the disc. Without it the blur reads as a glow rather than as a blade
    // sweeping a circle.
    g.strokeStyle = 'rgba(226, 237, 245, 0.34)';
    g.lineWidth = 1;
    g.beginPath();
    g.arc(ax, ay, rotor - 0.5, 0, Math.PI * 2);
    g.stroke();
  };

  const D = arm / Math.SQRT2; // corners of a square, so all four arms are the same length
  const arms = [
    [cx - D, cy - D],
    [cx + D, cy - D],
    [cx - D, cy + D],
    [cx + D, cy + D],
  ];

  // Arms first, so the rotor discs sit on top of their own booms.
  g.strokeStyle = '#39434f';
  g.lineWidth = 3.4;
  g.lineCap = 'round';
  for (const [ax, ay] of arms) {
    g.beginPath();
    g.moveTo(cx, cy);
    g.lineTo(ax, ay);
    g.stroke();
  }
  for (const [ax, ay] of arms) rotorAt(ax, ay);
  // Rotor hubs, so each boom ends in something solid rather than fading out.
  g.fillStyle = '#2b333d';
  for (const [ax, ay] of arms) {
    g.beginPath();
    g.arc(ax, ay, 2.6, 0, Math.PI * 2);
    g.fill();
  }

  // ---- body -------------------------------------------------------------------------------
  // Lit from the top-left, like the mechs: the highlight is offset toward that corner so a drone
  // sitting next to a chassis agrees with it about where the light is.
  const hull = g.createRadialGradient(cx - 4, cy - 5, 1, cx, cy, body);
  hull.addColorStop(0, '#7e8a99');
  hull.addColorStop(0.55, '#59646f');
  hull.addColorStop(1, '#3c454f');
  g.fillStyle = hull;
  g.beginPath();
  g.arc(cx, cy, body, 0, Math.PI * 2);
  g.fill();

  g.strokeStyle = '#222931';
  g.lineWidth = 1.6;
  g.beginPath();
  g.arc(cx, cy, body, 0, Math.PI * 2);
  g.stroke();

  // A panel line around the hull. One ring is enough to say "built" rather than "moulded".
  g.strokeStyle = 'rgba(24, 30, 37, 0.55)';
  g.lineWidth = 1;
  g.beginPath();
  g.arc(cx, cy, body - 3.5, 0, Math.PI * 2);
  g.stroke();

  // ---- the lens ----------------------------------------------------------------------------
  // 0x4fa8ff is the simulation's system blue - the shield rim, the boss outline and the cockpit
  // glass are all this colour, so a drone reads as one of the player's things at a glance.
  const lens = g.createRadialGradient(cx - 1, cy - 1.5, 0, cx, cy, 5.6);
  lens.addColorStop(0, '#eaf6ff');
  lens.addColorStop(0.35, '#8fd0ff');
  lens.addColorStop(1, '#2b74c4');
  g.fillStyle = lens;
  g.beginPath();
  g.arc(cx, cy, 5.6, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = 'rgba(18, 26, 34, 0.75)';
  g.lineWidth = 1.2;
  g.beginPath();
  g.arc(cx, cy, 5.6, 0, Math.PI * 2);
  g.stroke();

  // A specular nick, top-left, matching the hull's light.
  g.fillStyle = 'rgba(255, 255, 255, 0.75)';
  g.beginPath();
  g.ellipse(cx - 2, cy - 2.4, 1.7, 1.1, -0.6, 0, Math.PI * 2);
  g.fill();

  return c.toDataURL('image/png');
};

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

  const dataUrl = await page.evaluate(`(${DRAW_DRONE})()`);
  const buf = Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
  await writeFile(join(OUT_DIR, 'drone.png'), buf);
  console.log(`  drone            ${(buf.length / 1024).toFixed(1)} kB -> ${OUT_DIR}`);

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
