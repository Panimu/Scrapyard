/**
 * SETTINGS. The two preferences that already existed with nowhere to set them, plus the way into
 * the changelog.
 *
 * Both of these were reachable only by URL parameter (`?debug=1`) or by editing a literal, which
 * meant the render-scale cap - the one setting that can rescue a struggling phone - was in
 * practice unavailable to the person holding the struggling phone.
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

import type { Settings } from '../appState.js';

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
