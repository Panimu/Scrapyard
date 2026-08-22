/**
 * WHETHER THINGS MOVE. One answer, computed in one place, published to CSS and to JS.
 *
 * ---------------------------------------------------------------------------------------------
 * WHY THE MEDIA QUERY IS NOT READ DIRECTLY ANY MORE
 * ---------------------------------------------------------------------------------------------
 * `prefers-reduced-motion` used to be consulted from two places that could not see each other:
 * `chestOverlay.ts` asked `matchMedia` to decide whether to build a spin at all, and `styles.css`
 * asked `@media` to decide whether the landing flares were allowed to run. That worked only
 * because both were reading the same immutable system value.
 *
 * A player setting breaks that. CSS cannot read `Settings`, so the moment the preference stopped
 * being purely a system fact the two readers had to be given a single source of truth they could
 * BOTH see - and the only thing that fits is an attribute on the root element. `data-motion` is
 * that attribute. It holds the RESOLVED answer, never the preference: by the time it is written,
 * `system` has already been turned into one of the two real states.
 *
 * So `styles.css` contains no `@media (prefers-reduced-motion)` blocks at all. Every one of them
 * is now keyed on `:root[data-motion='reduce']`, and this file is the only thing that decides what
 * goes in there. A stray media query added later would be a second opinion, and it would disagree
 * with this one exactly when a player has overridden their system setting - which is the only case
 * any of this exists for.
 *
 * ---------------------------------------------------------------------------------------------
 * IT IS APPLIED BEFORE THE FIRST PAINT
 * ---------------------------------------------------------------------------------------------
 * `applyMotion` runs during boot, before any overlay is constructed. An attribute that arrives
 * late would let a transition play its first frames and then be cancelled mid-flight, which looks
 * worse than either honest state.
 */

import type { MotionPref, Settings } from '../appState.js';

/** The media query, asked in exactly one place so the string cannot drift. */
function systemPrefersReduced(): boolean {
  // `matchMedia` is absent in jsdom-less test environments and in the headless sim harness, and a
  // missing browser API is not a reason for the UI layer to throw. No preference means no
  // reduction, which is what a browser that has never heard of the query does anyway.
  if (typeof matchMedia !== 'function') return false;
  return matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * The resolved answer for a given preference: does the game reduce motion right now?
 *
 * Pure apart from the media query, and exported because `chestOverlay` needs the same answer the
 * stylesheet is working from. Nothing else in the UI should be asking `matchMedia` itself.
 */
export function reducesMotion(pref: MotionPref): boolean {
  if (pref === 'on') return false;
  if (pref === 'off') return true;
  return systemPrefersReduced();
}

/**
 * Publish the resolved answer to the stylesheet.
 *
 * Always writes, and always writes one of the two concrete values rather than leaving the
 * attribute off for the common case. An absent attribute would make `:root[data-motion='reduce']`
 * and "the attribute has not been applied yet" indistinguishable in the DOM inspector, and this is
 * a setting whose whole history is people not being able to tell which state they are in.
 */
export function applyMotion(settings: Settings): void {
  document.documentElement.dataset.motion = reducesMotion(settings.animations) ? 'reduce' : 'full';
}

/**
 * What the stylesheet is currently acting on, read back off the same attribute CSS matches.
 *
 * This rather than `reducesMotion(settings.animations)` is what animation code should ask, and the
 * difference is not pedantry: reading the published attribute makes it IMPOSSIBLE for JS and CSS
 * to disagree, because there is only one value and both are looking at it. Recomputing from
 * `Settings` would be a second evaluation of the same question, and a second evaluation is a
 * chance to drift - which is exactly the bug this whole file exists to make unrepresentable.
 */
export function motionIsReduced(): boolean {
  return document.documentElement.dataset.motion === 'reduce';
}

/**
 * Re-resolve whenever the SYSTEM preference changes, so a player who flips Reduce Motion in
 * Accessibility while the game is open sees it take effect without a reload.
 *
 * Only matters in `system` mode, but it is wired unconditionally and re-reads the preference each
 * time: subscribing and unsubscribing as the setting changes would be more state to get wrong than
 * the listener costs, and `applyMotion` is a single attribute write.
 */
export function watchSystemMotion(settings: Settings): void {
  if (typeof matchMedia !== 'function') return;
  const mq = matchMedia('(prefers-reduced-motion: reduce)');
  // Safari only grew `addEventListener` on MediaQueryList in 14; the game supports older iOS than
  // that in principle, and the deprecated `addListener` is the one both understand. Feature-detect
  // rather than assume, because the modern path is what every other browser wants.
  if (typeof mq.addEventListener === 'function') {
    mq.addEventListener('change', () => applyMotion(settings));
  } else if (typeof mq.addListener === 'function') {
    mq.addListener(() => applyMotion(settings));
  }
}
