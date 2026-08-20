/**
 * `npm run cityenemies` - bakes City Chaos's enemy sprites from the vendored Quaternius models.
 *
 * ---------------------------------------------------------------------------------------------
 * WHY THESE SPRITES ARE BAKED FROM 3D, WHEN EVERY OTHER MAP'S ARE FLAT ART
 * ---------------------------------------------------------------------------------------------
 * The City Chaos roster was chosen from Quaternius's CC0 low-poly packs (assets/quaternius/), and
 * those ship as MODELS, not sprites. The game draws flat sprites. So this tool stands each model
 * in a fixed studio - one orthographic camera, one lighting rig, one facing - and photographs it
 * once, exactly the way `npm run mechs` photographs the player chassis drawings. The PNGs are
 * checked in; nobody needs this tool to build or play.
 *
 * ONE CAMERA FOR THE WHOLE ROSTER. Elevation 50, a quarter-turn of yaw per model so every machine
 * faces EAST (+x) - `ART_FACING_BY_LEVEL['city-chaos']` is 1, and the renderer mirrors for
 * westward travel. A roster shot from per-model angles would read as clip art from three
 * different games; the single rig is what makes nineteen models one army.
 *
 * ---------------------------------------------------------------------------------------------
 * RECOLOURS HAPPEN HERE, NOT IN THE VENDORED FILES
 * ---------------------------------------------------------------------------------------------
 * Three designs are retinted at bake time - the tank to dozer yellow, the rover's atlas to
 * municipal teal, the fighter's hull to patrol green - by material name or by a bright-neutral
 * pixel transform on the texture. The files under assets/quaternius/ stay byte-identical to
 * upstream, so a re-fetch can always be diffed against them; the recolour is code, reviewable
 * and repeatable, in this file.
 *
 * ---------------------------------------------------------------------------------------------
 * TWO LOADER QUIRKS, BOTH LOAD-BEARING
 * ---------------------------------------------------------------------------------------------
 *   - Old Blender FBX exports (the toon tank) carry a TransparencyFactor that three's FBXLoader
 *     reads as opacity 0: the mesh loads, renders, and is invisible. Forced back to opaque.
 *   - FBX arrives at centimetre scale; glTF and OBJ at metres. FBX is normalised by 0.01 so the
 *     framing maths below sees one unit system.
 *
 * NEVER run `npx playwright install` - browsers are preinstalled at /opt/pw-browsers.
 */

import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import { join, extname, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'public', 'sprites');

/**
 * THE ROSTER. One row per baked sprite; `src/core/content/creaturesCity.ts` names these keys.
 *
 * `yaw` is the quarter-turn that faces the machine east, found by CONTACT SHEET rather than
 * assumed. Blender's forward axis survives each exporter differently - the cyberpunk sentries
 * and the rover come out east at 90, the war mechs and quad mechs at 270, and the tank at 180.
 * The fighter was first recorded at 270 too, on the same assumption as the other yaw-270 rows,
 * but its pack's forward axis does not match theirs: 270 baked it nose-to-the-west, and every run
 * it flew showed a jet backing sideways into the horde. 90 is what the rendered PNG actually
 * shows nose east - so every value below was read off a rendered probe, not derived.
 *
 * `tint` is one of the recolour modes documented above; most rows have none.
 */
const JOBS = [
  // The regulars, cycles 1-8.
  { key: 'city_robot', model: 'assets/quaternius/lowpoly-robot/Robot.obj', yaw: 90 },
  { key: 'city_2legs', model: 'assets/quaternius/cyberpunk-game-kit/Enemy_2Legs.gltf', yaw: 90 },
  { key: 'city_flying', model: 'assets/quaternius/cyberpunk-game-kit/Enemy_Flying.gltf', yaw: 90 },
  { key: 'city_rover', model: 'assets/quaternius/ultimate-space-kit/Rover_1.gltf', yaw: 90, tint: 'atlasTeal' },
  { key: 'city_2legs_gun', model: 'assets/quaternius/cyberpunk-game-kit/Enemy_2Legs_Gun.gltf', yaw: 90 },
  { key: 'city_flying_gun', model: 'assets/quaternius/cyberpunk-game-kit/Enemy_Flying_Gun.gltf', yaw: 90 },
  { key: 'city_fighter', model: 'assets/quaternius/lowpoly-spaceships/Spaceship3.obj', yaw: 90, tint: 'hullGreen' },
  { key: 'city_tank', model: 'assets/quaternius/animated-tanks/Tank.obj', yaw: 180, tint: 'dozerYellow' },

  // Cycle 1's elite.
  { key: 'city_cyb_large', model: 'assets/quaternius/cyberpunk-game-kit/Enemy_Large.gltf', yaw: 90 },

  // The boss lane. Stan and Frog each bake ONCE - their second, bigger creature row reuses the
  // same sprite at a different drawSize, which is the cascade's whole visual point.
  { key: 'city_george', model: 'assets/quaternius/animated-mech/George.gltf', yaw: 270 },
  { key: 'city_leela', model: 'assets/quaternius/animated-mech/Leela.gltf', yaw: 270 },
  { key: 'city_stan', model: 'assets/quaternius/animated-mech/Stan.gltf', yaw: 270 },
  { key: 'city_mike', model: 'assets/quaternius/animated-mech/Mike.gltf', yaw: 270 },
  { key: 'city_bee', model: 'assets/quaternius/ultimate-space-kit/Mech_BarbaraTheBee.gltf', yaw: 270 },
  { key: 'city_flamingo', model: 'assets/quaternius/ultimate-space-kit/Mech_FernandoTheFlamingo.gltf', yaw: 270 },
  { key: 'city_frog', model: 'assets/quaternius/ultimate-space-kit/Mech_FinnTheFrog.gltf', yaw: 270 },
  { key: 'city_panda', model: 'assets/quaternius/ultimate-space-kit/Mech_RaeTheRedPanda.gltf', yaw: 270 },
];

/** Rendered canvas edge, px. Trimmed to content before writing, so this is headroom, not size. */
const RENDER_SIZE = 448;
/** Camera elevation, degrees. One rig for the whole roster - see the header. */
const ELEVATION = 50;

/**
 * The studio page. three.js is served out of node_modules by the same little file server that
 * serves the models, so the page has no network access and needs none.
 */
const PAGE = `<!doctype html><html><head><meta charset="utf-8">
<style>html,body{margin:0;background:#0000}</style>
<script type="importmap">
{"imports":{"three":"/node_modules/three/build/three.module.js","three/addons/":"/node_modules/three/examples/jsm/"}}
</script></head><body><script type="module">
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';

// -- Recolour modes ------------------------------------------------------------------------

// Dozer yellow, by material name, preserving the pack's own light/dark structure.
const DOZER = {
  Main: [0.72, 0.54, 0.10],
  Main_Light: [0.82, 0.65, 0.16],
  Main_Dark: [0.42, 0.31, 0.06],
  Main_Details: [0.13, 0.13, 0.14],
  Wheels: [0.09, 0.09, 0.10],
};

function applyTint(root, tint) {
  if (!tint) return;
  root.traverse((o) => {
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (!m) continue;
      if (tint === 'dozerYellow' && DOZER[m.name]) m.color.setRGB(...DOZER[m.name]);
      if (tint === 'hullGreen' && m.name === 'White') m.color.setRGB(0.42, 0.58, 0.30);
      if (tint === 'atlasTeal' && m.map && m.map.image) {
        // Bright neutral texels take the teal hue scaled by their own brightness; the dark
        // wheels and trim stay. Same transform the roster proposal was approved on.
        const img = m.map.image;
        const c = document.createElement('canvas');
        c.width = img.width; c.height = img.height;
        const g = c.getContext('2d');
        g.drawImage(img, 0, 0);
        const d = g.getImageData(0, 0, c.width, c.height);
        const TEAL = [52, 148, 164];
        for (let i = 0; i < d.data.length; i += 4) {
          const r = d.data[i], gg = d.data[i + 1], b = d.data[i + 2];
          const mx = Math.max(r, gg, b), mn = Math.min(r, gg, b);
          if (mx - mn < 32 && mx > 110) {
            const k = mx / 255;
            d.data[i] = TEAL[0] * k; d.data[i + 1] = TEAL[1] * k; d.data[i + 2] = TEAL[2] * k;
          }
        }
        g.putImageData(d, 0, 0);
        const t = new THREE.CanvasTexture(c);
        t.colorSpace = m.map.colorSpace;
        t.flipY = m.map.flipY;
        t.magFilter = m.map.magFilter;
        t.minFilter = m.map.minFilter;
        m.map = t;
        m.needsUpdate = true;
      }
    }
  });
}

// -- The studio ----------------------------------------------------------------------------

window.bake = async (url, size, elevationDeg, yawDeg, tint) => {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setSize(size, size, false);
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  let root;
  if (/\\.fbx$/i.test(url)) {
    root = await new FBXLoader().loadAsync(url);
    root.scale.setScalar(0.01); // centimetre-scale exports - see the header.
  } else if (/\\.obj$/i.test(url)) {
    const materials = await new MTLLoader().loadAsync(url.replace(/\\.obj$/i, '.mtl'));
    materials.preload();
    const loader = new OBJLoader();
    loader.setMaterials(materials);
    root = await loader.loadAsync(url);
  } else {
    root = (await new GLTFLoader().loadAsync(url)).scene;
  }

  // The FBX opacity-zero quirk, and skinned materials - see the header.
  root.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = false;
    o.receiveShadow = false;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (!m) continue;
      if (m.opacity < 1) m.opacity = 1;
      m.transparent = false;
    }
  });
  applyTint(root, tint);

  // Face east: yaw about +y, applied to the model rather than the camera so the lighting rig
  // stays fixed and every sprite is lit from the same side.
  root.rotation.y = (yawDeg * Math.PI) / 180;
  root.updateMatrixWorld(true);
  scene.add(root);

  const box = new THREE.Box3().setFromObject(root);
  const c = box.getCenter(new THREE.Vector3());
  const s = box.getSize(new THREE.Vector3());
  const span = Math.max(s.x, s.z) * 0.62 + s.y * 0.18;
  const radius = Math.max(s.x, s.z) * 0.5;

  const el = (elevationDeg * Math.PI) / 180;
  const dist = Math.max(s.x, s.y, s.z) * 6 + 10;
  const cam = new THREE.OrthographicCamera(-span, span, span, -span, 0.01, dist * 4);
  cam.position.set(c.x, c.y + Math.sin(el) * dist, c.z + Math.cos(el) * dist);
  cam.lookAt(c);

  // The same three-light rig the roster was approved on: one warm key high front-left, a cool
  // fill, and enough ambient that the flat faces stay readable.
  const key = new THREE.DirectionalLight(0xffffff, 2.1);
  key.position.set(c.x - radius * 3, c.y + radius * 6 + s.y * 3, c.z + radius * 2.2);
  key.target.position.copy(c);
  scene.add(key, key.target);
  scene.add(new THREE.DirectionalLight(0xc8d4ff, 0.55).translateX(radius * 4).translateY(radius * 2));
  scene.add(new THREE.AmbientLight(0xffffff, 1.15));

  renderer.render(scene, cam);
  const out = renderer.domElement.toDataURL('image/png');
  renderer.dispose();
  return out;
};
window.__ready = true;
</script></body></html>`;

/** Trims a PNG data URL to its opaque bounding box, plus one pixel of margin. */
const TRIM = `(dataUrl) => new Promise((res) => {
  const im = new Image();
  im.onload = () => {
    const c = document.createElement('canvas');
    c.width = im.width; c.height = im.height;
    const g = c.getContext('2d');
    g.drawImage(im, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1;
    for (let y = 0; y < c.height; y++) {
      for (let x = 0; x < c.width; x++) {
        if (d[(y * c.width + x) * 4 + 3] === 0) continue;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
    if (x1 < 0) { res(null); return; }
    x0 = Math.max(0, x0 - 1); y0 = Math.max(0, y0 - 1);
    x1 = Math.min(c.width - 1, x1 + 1); y1 = Math.min(c.height - 1, y1 + 1);
    const w = x1 - x0 + 1, h = y1 - y0 + 1;
    const o = document.createElement('canvas');
    o.width = w; o.height = h;
    o.getContext('2d').drawImage(c, x0, y0, w, h, 0, 0, w, h);
    res({ url: o.toDataURL('image/png'), w, h });
  };
  im.src = dataUrl;
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

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.gltf': 'model/gltf+json',
  '.obj': 'text/plain',
  '.mtl': 'text/plain',
  '.fbx': 'application/octet-stream',
};

async function main() {
  const server = createServer(async (req, res) => {
    try {
      const path = decodeURIComponent(req.url.split('?')[0]);
      if (path === '/studio.html') {
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end(PAGE);
        return;
      }
      const buf = await readFile(join(ROOT, path));
      res.writeHead(200, { 'content-type': MIME[extname(path)] ?? 'application/octet-stream' });
      res.end(buf);
    } catch {
      res.writeHead(404);
      res.end('no');
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  const { chromium } = await import('@playwright/test');
  const launchOptions = { args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox'] };
  const found = resolveChromium();
  if (found !== undefined) launchOptions.executablePath = found;

  const browser = await chromium.launch(launchOptions);
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.error('  PAGE THROW', e.message));
  await page.goto(`http://127.0.0.1:${port}/studio.html`);
  await page.waitForFunction('window.__ready === true', null, { timeout: 30000 });

  await mkdir(OUT_DIR, { recursive: true });

  for (const job of JOBS) {
    const raw = await page.evaluate(
      ([u, s, e, y, t]) => window.bake(u, s, e, y, t),
      [`http://127.0.0.1:${port}/${job.model}`, RENDER_SIZE, ELEVATION, job.yaw, job.tint ?? null],
    );
    const trimmed = await page.evaluate(`(${TRIM})(${JSON.stringify(raw)})`);
    if (trimmed === null) {
      throw new Error(`${job.key}: rendered fully transparent - the model did not load or lost its materials`);
    }
    const buf = Buffer.from(trimmed.url.slice(trimmed.url.indexOf(',') + 1), 'base64');
    await writeFile(join(OUT_DIR, `${job.key}.png`), buf);
    console.log(
      `  ${`${job.key}.png`.padEnd(22)} ${String(trimmed.w).padStart(3)}x${String(trimmed.h).padEnd(3)} ${(buf.length / 1024).toFixed(1).padStart(6)} kB   ${job.model.split('/').pop()}${job.tint ? `  [${job.tint}]` : ''}`,
    );
  }

  await browser.close();
  server.close();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
