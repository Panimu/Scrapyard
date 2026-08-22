/**
 * SETTINGS. The preferences that had nowhere to be set, plus the way into the changelog.
 *
 * Two of these were reachable only by URL parameter (`?debug=1`) or by editing a literal, which
 * meant the render-scale cap - the one setting that can rescue a struggling phone - was in
 * practice unavailable to the person holding the struggling phone.
 *
 * ANIMATIONS is the third, and it is here for a different reason: it was not merely unreachable,
 * it was being decided by something that did not know what it was deciding. See `MotionPref`.
 *
 * RENDER SCALE APPLIES ON RELOAD, and the screen says so rather than pretending otherwise. The
 * resolution is handed to Pixi once at boot; re-applying it live means resizing the backing store
 * and rebuilding every render target mid-run, which is a real change to the renderer and not a
 * settings screen's job. A toggle that quietly does nothing until later is worse than a toggle
 * that says when it lands.
 *
 * THE SETTINGS SAVE ON CHANGE, not on Back. There is no confirm step here and no way to cancel,
 * so leaving by any route - the button, the hardware back gesture, closing the tab - has to keep
 * what was just set.
 */

import type { MotionPref, Settings } from '../appState.js';

export class SettingsScreen {
  readonly element: HTMLDivElement;

  constructor(
    private readonly settings: Settings,
    actions: { onBack: () => void; onChanged: () => void; onChangelog: () => void },
  ) {
    const el = document.createElement('div');
    el.className = 'overlay settings';
    el.hidden = true;
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Settings');

    const head = document.createElement('div');
    head.className = 'settings__head';
    head.innerHTML = `<div class="eyebrow">Options</div><h1 class="settings__title">Settings</h1>`;
    el.appendChild(head);

    const list = document.createElement('div');
    list.className = 'settings__list';

    list.appendChild(
      toggleRow(
        'Performance mode',
        'Renders at half resolution. Takes effect next time the game loads.',
        settings.dprCap === 1,
        (on) => {
          this.settings.dprCap = on ? 1 : 2;
          actions.onChanged();
        },
      ),
    );

    // THREE CHOICES RATHER THAN A SWITCH, and the note names the platform quirk that forced it.
    // "Automatic" is honest about deferring to the device; the other two exist because on Windows
    // the device's answer comes from a setting about window minimise animations and means nothing
    // about this game. See `MotionPref`.
    list.appendChild(
      choiceRow<MotionPref>(
        'Animations',
        'Spinning chest reels, bar fills and screen effects. Automatic follows your device’s ' +
          'reduce-motion setting, which some systems turn on for reasons unrelated to games.',
        [
          { value: 'system', label: 'Auto' },
          { value: 'on', label: 'On' },
          { value: 'off', label: 'Off' },
        ],
        settings.animations,
        (value) => {
          this.settings.animations = value;
          actions.onChanged();
        },
      ),
    );

    list.appendChild(
      toggleRow(
        'Debug readout',
        'Frame time, entity counts and dropped events, over the HUD.',
        settings.debug,
        (on) => {
          this.settings.debug = on;
          actions.onChanged();
        },
      ),
    );

    el.appendChild(list);

    const row = document.createElement('div');
    row.className = 'settings__actions';

    const changes = document.createElement('button');
    changes.type = 'button';
    changes.className = 'btn';
    changes.textContent = 'Changelog';
    changes.addEventListener('click', actions.onChangelog);

    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'btn btn--primary';
    back.textContent = 'Back';
    back.addEventListener('click', actions.onBack);

    row.append(changes, back);
    el.appendChild(row);

    this.element = el;
  }

  show(): void {
    this.element.hidden = false;
  }

  hide(): void {
    this.element.hidden = true;
  }
}

/**
 * One labelled switch. A `<button>` with `aria-pressed` rather than a checkbox: it is styled from
 * nothing either way, and a button is the control that already has a 44 px tap target here.
 */
function toggleRow(
  label: string,
  note: string,
  initial: boolean,
  onToggle: (on: boolean) => void,
): HTMLDivElement {
  const row = document.createElement('div');
  row.className = 'setting';

  const text = document.createElement('div');
  text.className = 'setting__text';

  const name = document.createElement('div');
  name.className = 'setting__name';
  name.textContent = label;

  const sub = document.createElement('div');
  sub.className = 'setting__note';
  sub.textContent = note;

  text.append(name, sub);

  let on = initial;
  const sw = document.createElement('button');
  sw.type = 'button';
  sw.className = 'switch';
  sw.setAttribute('aria-label', label);
  const paint = (): void => {
    sw.classList.toggle('switch--on', on);
    sw.setAttribute('aria-pressed', on ? 'true' : 'false');
  };
  paint();
  sw.addEventListener('click', () => {
    on = !on;
    paint();
    onToggle(on);
  });

  row.append(text, sw);
  return row;
}

/**
 * One labelled segmented control. Same row furniture as `toggleRow`, but for a setting with more
 * than two states.
 *
 * `radio`/`radiogroup` rather than a row of plain buttons: a screen reader has to be able to say
 * "two of three" here, and this is a settings screen - the one place in the game where a control
 * is read rather than reacted to. The buttons carry `aria-checked` and the group carries the
 * label, which is the pairing that makes that announcement work.
 */
function choiceRow<T extends string>(
  label: string,
  note: string,
  options: readonly { value: T; label: string }[],
  initial: T,
  onPick: (value: T) => void,
): HTMLDivElement {
  const row = document.createElement('div');
  row.className = 'setting';

  const text = document.createElement('div');
  text.className = 'setting__text';

  const name = document.createElement('div');
  name.className = 'setting__name';
  name.textContent = label;

  const sub = document.createElement('div');
  sub.className = 'setting__note';
  sub.textContent = note;

  text.append(name, sub);

  const group = document.createElement('div');
  group.className = 'segmented';
  group.setAttribute('role', 'radiogroup');
  group.setAttribute('aria-label', label);

  let current = initial;
  const buttons: HTMLButtonElement[] = [];
  const paint = (): void => {
    for (let i = 0; i < buttons.length; i++) {
      const on = options[i].value === current;
      buttons[i].classList.toggle('segmented__opt--on', on);
      buttons[i].setAttribute('aria-checked', on ? 'true' : 'false');
    }
  };

  for (const opt of options) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'segmented__opt';
    b.setAttribute('role', 'radio');
    b.textContent = opt.label;
    b.addEventListener('click', () => {
      // Re-picking the live option is a no-op rather than a save: this screen writes through on
      // every change, and a settings write is a localStorage round-trip.
      if (current === opt.value) return;
      current = opt.value;
      paint();
      onPick(opt.value);
    });
    buttons.push(b);
    group.appendChild(b);
  }
  paint();

  row.append(text, group);
  return row;
}
