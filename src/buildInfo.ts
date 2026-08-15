/**
 * WHICH BUILD THIS IS, substituted by Vite at build time (see `define` in vite.config.ts).
 *
 * A `define` rather than a generated file, because a generated file is a file that can be stale,
 * committed by accident, or forgotten in `.gitignore`. This value cannot drift from the build that
 * carries it: it does not exist until the build makes it.
 *
 * Reads `dev build` when Vite is not doing the substituting - `vitest`, or a bundler that has not
 * been told about it - which is honest rather than a version number that means nothing.
 */
declare const __BUILD_LABEL__: string | undefined;

export const BUILD_LABEL: string =
  typeof __BUILD_LABEL__ === 'string' ? __BUILD_LABEL__ : 'dev build';
