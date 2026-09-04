/// <reference types="vitest/config" />
import { execSync } from 'node:child_process';
import { defineConfig } from 'vitest/config';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * Vite + PWA + vitest, in one file so the phone workflow has one place to look.
 *
 * The PWA plugin is skipped under vitest: it has nothing to do during unit tests and its
 * virtual modules only confuse the transform pipeline.
 */
const isTest = process.env.VITEST === 'true' || process.env.NODE_ENV === 'test';

/**
 * SINGLEFILE=1 builds one self-contained bundle instead of the normal split build.
 *
 * It exists for sandboxed hosts that serve a single HTML document under a CSP which blocks every
 * external request - no second script, no sprite fetch. `tools/inline_build.mjs` folds that build
 * plus every sprite into one .html. It is a SHARING format, not the shipping one: the real deploy
 * keeps the split chunks and the service worker, which is what makes reloads on cellular cheap.
 */
const isSingleFile = process.env.SINGLEFILE === '1';

/**
 * THE BUILD NUMBER, printed on the title screen.
 *
 * It is the COMMIT COUNT, not a counter this file increments. A number stored in the repo and
 * bumped by the build would change on every local `npm run build` - a dozen times in an afternoon
 * of work that produces one deploy - and every one of those bumps is a diff to commit. The commit
 * count moves exactly once per commit, which for this project is exactly once per deploy: the
 * workflow publishes every push.
 *
 * The short SHA goes with it because the number alone answers "is my phone newer than yours" and
 * nothing else. The pair answers "which build is this", which is the question actually being asked
 * when someone reads a version off a screen.
 *
 * REQUIRES REAL HISTORY. `actions/checkout` clones one commit by default, which would make this 1
 * on every deploy - the workflow sets `fetch-depth: 0` for exactly this reason. If git is missing
 * or shallow anyway, this degrades to `dev` rather than to a wrong number: a version that lies is
 * worse than a version that admits it does not know.
 */
function git(cmd: string): string {
  try {
    return execSync(`git ${cmd}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return '';
  }
}

const commitCount = git('rev-list --count HEAD');
const shortSha = git('rev-parse --short HEAD');
const buildNumber = /^[0-9]+$/.test(commitCount) && commitCount !== '1' ? commitCount : '';
const buildLabel =
  buildNumber !== '' && shortSha !== '' ? `v${buildNumber} · ${shortSha}` : 'dev build';

export default defineConfig({
  // Relative base so the built bundle works from a subpath as well as from a Pages root.
  base: './',

  // Substituted at build time, so the running bundle carries the identity of the commit it was
  // built from without a source file having to be edited to say so.
  define: {
    __BUILD_LABEL__: JSON.stringify(buildLabel),
  },

  server: {
    // The whole point is loading it on a phone on the same network.
    host: true,
    port: 5173,
    strictPort: false,
  },

  build: {
    target: 'es2022',
    // -------------------------------------------------------------------------------------
    // SOURCEMAPS ARE OFF BY DEFAULT, AND THIS IS A REVERSAL
    // -------------------------------------------------------------------------------------
    // They used to be on for every build but the single-file one, on the grounds that they are
    // 2.8 MB of a 4.2 MB build and pure overhead when inlined. That reasoning was about SIZE and
    // missed the larger point: a deployed map is the whole of `src/` in readable form, comments
    // and filenames included, served to anyone who opens devtools. The live site was handing out
    // 100 source files - 60 of them the deterministic core - to anyone who asked for one URL.
    //
    // That is independent of whether the repository is public. A repository can be made private
    // in an afternoon; a map already published stays published until the next deploy replaces it.
    //
    // SOURCEMAP=1 turns them back on for a local build, which is what to do when a production
    // stack trace needs to be legible. The default is the safe one because the deploy workflow
    // takes the default, and a setting that protects you only when someone remembers it does not.
    sourcemap: !isSingleFile && process.env.SOURCEMAP === '1',
    // Safari's parser is fine with modern syntax; keep names readable in the on-device HUD.
    minify: 'esbuild',
    rollupOptions: {
      output: isSingleFile
        ? // One chunk, no code splitting: a second <script> could not be fetched under the CSP.
          { inlineDynamicImports: true }
        : {
            // Pixi is big and changes rarely; a separate chunk keeps game-code deploys small,
            // which matters when the update path is "reload on a phone over cellular".
            manualChunks: (id: string): string | undefined =>
              id.includes('node_modules/pixi.js') ? 'pixi' : undefined,
          },
    },
  },

  plugins: isTest
    ? []
    : isSingleFile
    ? [
        {
          // main.ts imports `virtual:pwa-register` to drive the update toast; that module is
          // supplied by VitePWA, which is off here. A single file has no service worker and
          // nothing to update, so resolve it to an inert stub rather than dragging the plugin in.
          name: 'stub-pwa-register',
          resolveId: (id: string): string | undefined =>
            id === 'virtual:pwa-register' ? '\0virtual:pwa-register' : undefined,
          load: (id: string): string | undefined =>
            id === '\0virtual:pwa-register'
              ? 'export const registerSW = () => () => Promise.resolve();'
              : undefined,
        },
      ]
    : [
        VitePWA({
          // 'prompt', never 'autoUpdate': without a visible "new version" toast the PWA serves a
          // stale bundle and every deploy looks like it failed (DESIGN.md §11).
          registerType: 'prompt',
          // src/ui owns registration (it draws the toast) via `virtual:pwa-register`.
          injectRegister: null,
          // public/manifest.webmanifest is hand-written and linked from index.html (Agent 7).
          manifest: false,
          workbox: {
            // mp3 IS IN HERE FOR THE SOUND, and it has to be: the game is installable and is
            // meant to play offline, and a precache that skips the audio gives an offline player a
            // silent game rather than a missing one - which looks like a broken build, not a
            // missing network. The whole library is 1.2 MB, smaller than the sprite atlas already
            // in this list.
            globPatterns: ['**/*.{js,css,html,png,webp,json,woff2,mp3}'],
            // The atlas is ~1-2 MB; the default 2 MiB cap would silently skip it.
            maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
            cleanupOutdatedCaches: true,
          },
          devOptions: { enabled: false },
        }),
      ],

  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    // The suites land with the invariants agent; until then `npm test` should report "0 tests",
    // not fail, so a red result always means something actually broke.
    passWithNoTests: true,
    // Determinism suites compare hashes across runs; parallel workers are fine but a stable
    // reporter ordering makes CI logs diffable.
    sequence: { shuffle: false },
    /**
     * THIRTY SECONDS, BECAUSE THESE ARE SIMULATIONS AND NOT UNIT TESTS.
     *
     * Vitest defaults to five, which suits a suite of assertions about pure functions. A good part
     * of this one steps a real world for thousands of ticks - `sheep`, `spawning`, `progression`
     * and the determinism suites all do - and the whole run spends over a minute inside test bodies
     * on an idle machine. On a loaded one, or a shared CI runner, the slowest of them cross five
     * seconds and fail for taking a while rather than for being wrong.
     *
     * That is the worst failure a suite can have: it is indistinguishable from a real break at a
     * glance, it lands on a DIFFERENT test each run, and it blocks the deploy - `npm test` guards
     * the publish step, so a flake is a site that silently does not update.
     *
     * It is a CEILING, not a budget. Nothing here takes anything like thirty seconds; the number
     * is set far enough clear of the real times that a genuine hang still fails, and a slow machine
     * does not.
     */
    testTimeout: 30_000,
  },
});
