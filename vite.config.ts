/// <reference types="vitest/config" />
import { defineConfig } from 'vitest/config';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * Vite + PWA + vitest, in one file so the phone workflow has one place to look.
 *
 * The PWA plugin is skipped under vitest: it has nothing to do during unit tests and its
 * virtual modules only confuse the transform pipeline.
 */
const isTest = process.env.VITEST === 'true' || process.env.NODE_ENV === 'test';

export default defineConfig({
  // Relative base so the built bundle works from a subpath as well as from a Pages root.
  base: './',

  server: {
    // The whole point is loading it on a phone on the same network.
    host: true,
    port: 5173,
    strictPort: false,
  },

  build: {
    target: 'es2022',
    sourcemap: true,
    // Safari's parser is fine with modern syntax; keep names readable in the on-device HUD.
    minify: 'esbuild',
    rollupOptions: {
      output: {
        // Pixi is big and changes rarely; a separate chunk keeps game-code deploys small,
        // which matters when the update path is "reload on a phone over cellular".
        manualChunks: (id: string): string | undefined =>
          id.includes('node_modules/pixi.js') ? 'pixi' : undefined,
      },
    },
  },

  plugins: isTest
    ? []
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
            globPatterns: ['**/*.{js,css,html,png,webp,json,woff2}'],
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
  },
});
