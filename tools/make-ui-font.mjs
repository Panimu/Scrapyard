/**
 * `npm run uifont` - bakes a proportional glyph atlas for the C# front-end's menu chrome, in the
 * same smooth system-ui face `npm run titlefont` already uses for the title wordmark.
 *
 * THE SAME REASONING AS `make-title-art.mjs`, EXTENDED TO EVERY PRINTABLE ASCII CHARACTER rather
 * than two fixed strings. `Font.cs`'s 5x7 bitmap grid is right for a HUD and for pixel-art-adjacent
 * chrome, and it stays exactly as it is for that; but a heading or a button label is not pixel art,
 * it is the game's own wordmark logotype applied to a shorter word, and it never was the pixel grid
 * on the platform this is a port OF - see the remarks on Font.cs and on title_word.png/title_sub.png
 * for why loading a live font at runtime was rejected and baking one was not.
 *
 * ONE WEIGHT, NOT MANY. The web build's CSS reaches for several - 800 on a heading, 600 on a
 * button, 400 in prose - but a bitmap atlas is baked once. 700 sits between them and reads correctly
 * as "the branded font" wherever it lands; running three atlases through the same pipeline for three
 * weights was not worth the build-time and texture-memory cost for a first pass.
 *
 * A FIXED CELL, NOT A TIGHT PACK. Every glyph gets the same cellW x cellH box in the atlas, sized to
 * the widest/tallest glyph baked plus padding, with its own baseline at the same row within the
 * cell every time - so two consecutive glyphs drawn at the same Y always share a baseline with no
 * per-glyph vertical bookkeeping at draw time. Wasted atlas space on "i" next to "M" costs nothing
 * a game this size will ever notice; the code it saves is worth more.
 *
 * THE METRIC THAT MATTERS IS THE ADVANCE, not the glyph's own ink width - a canvas's own
 * `measureText(ch).width` for the same font, which is what makes this PROPORTIONAL rather than a
 * second fixed-width grid: an "i" moves the pen less than an "M" does, which is the whole reason a
 * wrapped paragraph in this font takes fewer lines than the same paragraph in Font.cs's monospaced
 * one.
 *
 * NEVER run `npx playwright install` here. See make-title-art.mjs's own remark on this exact point.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_SPRITES = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'sprites');
const OUT_CS = resolve(
  dirname(fileURLToPath(import.meta.url)), '..', 'cs', 'src', 'Scrapyard.Game', 'UiFontMetrics.cs',
);

const FONT_STACK = `-apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif`;
const WEIGHT = 700;
const PX = 48; // baked size; well above any on-screen use, so it stays smooth scaled down
const FIRST = 32;
const LAST = 126;
const COLUMNS = 16;

// Runs INSIDE the page via page.evaluate - no access to anything above this line.
const BAKE = String(function bake(weight, px, fontStack, first, last, columns) {
  const measure = document.createElement('canvas').getContext('2d');
  measure.font = `${weight} ${px}px ${fontStack}`;
  measure.textBaseline = 'alphabetic';

  const n = last - first + 1;
  const chars = [];
  const advances = [];
  let maxAscent = 0;
  let maxDescent = 0;
  let maxWidth = 0;

  for (let c = first; c <= last; c++) {
    const ch = String.fromCharCode(c);
    chars.push(ch);
    const m = measure.measureText(ch);
    advances.push(m.width);
    maxAscent = Math.max(maxAscent, m.actualBoundingBoxAscent);
    maxDescent = Math.max(maxDescent, m.actualBoundingBoxDescent);
    maxWidth = Math.max(maxWidth, m.actualBoundingBoxLeft + m.actualBoundingBoxRight, m.width);
  }

  const padX = Math.ceil(px * 0.12);
  const padTop = Math.ceil(px * 0.08);
  const cellW = Math.ceil(maxWidth) + padX * 2;
  const cellH = Math.ceil(maxAscent + maxDescent) + padTop * 2;
  const baselineY = padTop + Math.ceil(maxAscent);

  const rows = Math.ceil(n / columns);
  const c = document.createElement('canvas');
  c.width = cellW * columns;
  c.height = cellH * rows;
  const g = c.getContext('2d');
  g.font = `${weight} ${px}px ${fontStack}`;
  g.textBaseline = 'alphabetic';
  g.fillStyle = '#ffffff';

  for (let i = 0; i < n; i++) {
    const col = i % columns;
    const row = Math.floor(i / columns);
    const x = col * cellW + padX;
    const y = row * cellH + baselineY;
    g.fillText(chars[i], x, y);
  }

  return {
    dataUrl: c.toDataURL('image/png'),
    cellW,
    cellH,
    baselineY,
    columns,
    rows,
    advances,
  };
});

function resolveChromium() {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH ?? '/opt/pw-browsers';
  if (existsSync(root)) {
    const candidates = [];
    for (const entry of readdirSync(root)) {
      if (entry.startsWith('chromium-')) candidates.push(join(root, entry, 'chrome-linux', 'chrome'));
    }
    for (const entry of readdirSync(root)) {
      if (entry.startsWith('chromium_headless_shell-')) {
        candidates.push(join(root, entry, 'chrome-linux', 'headless_shell'));
      }
    }
    const found = candidates.find((p) => existsSync(p));
    if (found !== undefined) return found;
  }
  const windowsCandidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ];
  return windowsCandidates.find((p) => existsSync(p));
}

function csEscape(s) {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

async function main() {
  const { chromium } = await import('@playwright/test');
  const launchOptions = {};
  const found = resolveChromium();
  if (found !== undefined) launchOptions.executablePath = found;

  const browser = await chromium.launch(launchOptions);
  const page = await browser.newPage();
  await page.goto('about:blank');
  await mkdir(OUT_SPRITES, { recursive: true });

  const args = [WEIGHT, PX, JSON.stringify(FONT_STACK), FIRST, LAST, COLUMNS].join(', ');
  const result = await page.evaluate(`(${BAKE})(${args})`);
  await browser.close();

  const buf = Buffer.from(result.dataUrl.slice(result.dataUrl.indexOf(',') + 1), 'base64');
  await writeFile(join(OUT_SPRITES, 'ui_font.png'), buf);

  const rows = [];
  for (let c = FIRST; c <= LAST; c++) {
    const ch = String.fromCharCode(c);
    const advance = result.advances[c - FIRST];
    rows.push(`        ${advance.toFixed(2)}f, // '${csEscape(ch)}'`);
  }

  const src = `namespace Scrapyard.Game;

/// <summary>
/// Layout for the proportional menu-chrome font baked by \`npm run uifont\` into
/// public/sprites/ui_font.png - see that script for why this exists and how it is baked.
/// </summary>
/// <remarks>
/// GENERATED. Re-run \`npm run uifont\` after changing the baking parameters in
/// tools/make-ui-font.mjs; nothing here should be hand-edited.
///
/// PURE DATA, NO MONOGAME - the same split FontMetrics/Font already makes, and for the same
/// reason: a headless test wrapping text to a width has no business creating a graphics device
/// to ask a font how wide a string is.
/// </remarks>
public static class UiFontMetrics
{
    public const int First = ${FIRST};
    public const int Last = ${LAST};
    public const int Columns = ${COLUMNS};
    public const int Rows = ${result.rows};
    public const int CellW = ${result.cellW};
    public const int CellH = ${result.cellH};

    /// <summary>Row within a cell the baseline sits on, in baked pixels from the cell's top.</summary>
    public const int BaselineY = ${result.baselineY};

    /// <summary>
    /// Baked pixels per Font.cs "scale" unit - the SAME unit every screen already computes
    /// (vh / 300, vh / 400, ...) and passes to Font.Draw, where it means "GlyphH (8) pixels tall".
    /// This font is baked at a completely different native size (cell height ${result.cellH}), so
    /// passing that same integer straight through as a multiplier on the baked cell drew text
    /// roughly ${result.cellH} / 8 times too large - which is exactly what happened before this
    /// constant existed. Multiplying every scale by this first makes UiFont.GlyphH(scale) equal
    /// Font.GlyphH * scale by construction, so a call site swapped from one font to the other keeps
    /// the same on-screen size without its own numbers changing.
    /// </summary>
    public const float PixelsPerUnit = 8f / BaselineY;

    /// <summary>How far the pen advances after each character, in baked pixels, indexed by (char - First).</summary>
    public static readonly float[] Advance =
    {
${rows.join('\n')}
    };

    /// <summary>The advance for a character, or a space's for anything outside the baked range.</summary>
    public static float AdvanceOf(char ch)
    {
        int i = ch - First;
        return i >= 0 && i < Advance.Length ? Advance[i] : Advance[' ' - First];
    }

    /// <summary>How wide a string is drawn, at a Font.cs-compatible scale (see PixelsPerUnit).</summary>
    public static int Measure(string s, float scale)
    {
        float px = scale * PixelsPerUnit;
        float w = 0;
        foreach (char ch in s)
        {
            if (ch == '\\n') continue;
            w += AdvanceOf(ch) * px;
        }
        return (int)System.MathF.Round(w);
    }

    /// <summary>Greedy word wrap to a pixel width, at the given scale.</summary>
    public static System.Collections.Generic.List<string> Wrap(string s, int widthPx, float scale)
    {
        var lines = new System.Collections.Generic.List<string>();
        var line = new System.Text.StringBuilder();
        foreach (string word in s.Split(' ', System.StringSplitOptions.RemoveEmptyEntries))
        {
            string candidate = line.Length == 0 ? word : line + " " + word;
            if (line.Length > 0 && Measure(candidate, scale) > widthPx)
            {
                lines.Add(line.ToString());
                line.Clear();
                line.Append(word);
            }
            else
            {
                line.Clear();
                line.Append(candidate);
            }
        }
        if (line.Length > 0) lines.Add(line.ToString());
        return lines;
    }
}
`;

  await writeFile(OUT_CS, src);
  console.log(`  ui_font.png       ${result.columns * result.cellW}x${result.rows * result.cellH}  ${(buf.length / 1024).toFixed(1)} kB`);
  console.log(`  UiFontMetrics.cs  ${LAST - FIRST + 1} glyphs, cell ${result.cellW}x${result.cellH}, baseline ${result.baselineY}`);
}

void main();
