using Microsoft.Xna.Framework;
using Microsoft.Xna.Framework.Graphics;

using Scrapyard.Core;
using Scrapyard.Meta;

namespace Scrapyard.Game;

/// <summary>Where the app is, outside a run.</summary>
public enum Screen
{
    Title,
    HeroSelect,
    LevelSelect,
    Workshop,
    Settings,
    Pedia,
    Changes,
    Playing,
    Paused,
}

/// <summary>
/// The menus: title, chassis, yard, workshop, pause.
/// </summary>
/// <remarks>
/// <para>
/// <b>THE SIMULATION IS NOT RUNNING BEHIND ANY OF THESE.</b> A menu is outside a run, not on top of
/// one - the world is built when a run starts and thrown away when it ends. That is why the
/// workshop can only be entered from outside: its tiers are read ONCE when the world is built and
/// never recomputed, so a purchase made mid-run would do nothing until the next one, which is worse
/// than not offering it.
/// </para>
/// <para>
/// <b>PAUSE IS THE EXCEPTION</b>, and it is a screen rather than a phase for a reason: the
/// simulation has no concept of paused. <c>RunPhase</c> has Intro, Running, LevelUp, Dead, Victory
/// and Chest, and none of them means "the player walked away". So pausing is simply the front-end
/// choosing not to step, which is exactly what it is.
/// </para>
/// <para>
/// <b>THE CRITERIA ARE PUBLISHED NOWHERE.</b> A locked chassis is a silhouette and a question mark.
/// The roster below draws the lock but never the condition - <c>UnlockCond</c> exists to be
/// evaluated, and the only place one is ever stated to a player is the achievement that fires on
/// earning it, in the past tense.
/// </para>
/// </remarks>
public static class Screens
{

    // -----------------------------------------------------------------------------------------

    // THE PALETTE IS SHARED AND IS THE WEB BUILD'S OWN. See Palette: these were a warm brown set
    // invented here, which read as sepia beside the original's cool slate.
    private static readonly Color Ink = Palette.Ink;
    private static readonly Color Dim = Palette.Dim;
    private static readonly Color Faint = Palette.Faint;
    private static readonly Color Locked = Palette.Locked;
    private static readonly Color Panel = Palette.Panel;
    private static readonly Color Edge = Palette.Edge;
    private static readonly Color Accent = Palette.Accent;
    private static readonly Color Good = Palette.Good;

    public static void DrawTitle(SpriteBatch batch, Sprites sprites, Settings save, int cursor,
                                 int badge, int vw, int vh)
    {
        Backdrop(batch, sprites, vw, vh);
        int scale = System.Math.Max(1, vh / 300);

        var rows = MenuRows.Title();
        int minutes = (int)System.Math.Round(Constants.RunLengthSec / 60);
        int tagScale = System.Math.Max(1, scale - 1);
        int rowH = 27 * scale;
        int gap = 6 * scale;
        int listW = System.Math.Min(vw - 40 * scale, 170 * scale);
        int x0 = (vw - listW) / 2;

        // MEASURED, THEN CENTRED, which is what `justify-content: center` does and what placing
        // things at fractions of the height does not. Sizing the mech against the wordmark is the
        // right RELATIONSHIP and it pushed Settings off the bottom of a 720-tall window, because
        // nothing had asked whether the block still fit.
        //
        // THE MECH IS WHAT GIVES, and it gives first. It is the one element with no words in it, so
        // shrinking it costs nothing a player needs to read; shrinking the menu or the name costs
        // legibility, and dropping a gap costs the layout its shape.
        int nameH = Font.GlyphH * scale * 4 + 6 * scale;
        int subH = Font.GlyphH * scale * 2 + 10 * scale;
        int tagH = Font.LineHeight * tagScale * 2 + 16 * scale;
        int menuH = rows.Length * (rowH + gap);
        int bankH = save.Credits > 0 ? Font.LineHeight * scale + 6 * scale : 0;
        int verH = Font.GlyphH * tagScale + 20 * scale;

        var art = sprites.Get("mech_slate");
        int artW = 0;
        int artH = 0;
        if (art is not null)
        {
            // A SHADE UNDER HALF THE WORDMARK'S WIDTH, which is the proportion the web build has.
            artW = Font.Measure("SCRAPYARD", scale * 4) / 2;
            artH = artW * art.Height / art.Width;

            int room = vh - (nameH + subH + tagH + menuH + bankH + verH) - 16 * scale;
            if (artH > room)
            {
                artH = System.Math.Max(0, room);
                artW = artH * art.Width / art.Height;
            }
        }

        int artGap = artH > 0 ? 8 * scale : 0;
        int total = artH + artGap + nameH + subH + tagH + menuH + bankH;
        int y = System.Math.Max(8 * scale, (vh - verH - total) / 2);

        if (artH > 0)
        {
            // A CHASSIS RATHER THAN A LOGO, because there is no logo and a mech is what the game is
            // about. Dimmed: it is behind the name rather than beside it.
            batch.Draw(art, new Rectangle((vw - artW) / 2, y, artW, artH), Color.White * 0.55f);
            y += artH + artGap;
        }

        Font.DrawCentred(batch, sprites.Blank, "SCRAPYARD", vw / 2, y, scale * 4, Ink);
        y += nameH;

        // SPACED OUT BY HAND. The bitmap font has one tracking value, so the wide letter-spacing
        // the wordmark wants is spaces between the glyphs - which is what it looks like anyway.
        Font.DrawCentred(batch, sprites.Blank, "S U R V I V O R S", vw / 2, y, scale * 2, Accent);
        y += subH;

        // THE WIN CONDITION, AND IT IS THE REAL ONE. Outlasting the clock is not winning: a run
        // ends in victory when the timer has passed AND no Scraplord is left standing, so the
        // minutes describe THE HORDE rather than the run. The number is derived rather than spelled
        // out, because a word in prose is a thing that cannot be checked.
        //
        // SMALLER AND FAINTER THAN THE BUTTONS - 13px against their 18 in the original: there to be
        // read once and then ignored.
        Font.DrawCentred(batch, sprites.Blank, $"HEAVY MECHS. {minutes} MINUTES OF HORDE.",
                         vw / 2, y, tagScale, Palette.Faint);
        Font.DrawCentred(batch, sprites.Blank, "EVERY SCRAPLORD DOWN.", vw / 2,
                         y + Font.LineHeight * tagScale, tagScale, Palette.Faint);
        y += tagH;

        for (int i = 0; i < rows.Length; i++)
        {
            var r = new Rectangle(x0, y, listW, rowH);
            Button(batch, sprites, r, rows[i].Label, scale, i == 0, i == cursor);

            // THE ATTRACT BADGE, and only when there is something to buy: a permanent sticker stops
            // meaning anything the first time it is seen not to be true.
            //
            // ON THE TOP-RIGHT CORNER, hanging off it. It is a sticker slapped on the button rather
            // than part of it, which is why it overlaps the edge and carries a dark ring to lift it
            // off - `top: -9px; right: -10px` with a 2px border of the page ground.
            if (i == 1 && badge >= 0)
            {
                string word = MenuRows.AttractStrings[badge % MenuRows.AttractStrings.Length];
                int pad = 4 * scale;
                int bw = Font.Measure(word, scale) + pad * 2;
                int bh = Font.GlyphH * scale + pad;
                var box = new Rectangle(r.Right - bw + 5 * scale, r.Y - bh / 2, bw, bh);

                int ring = System.Math.Max(1, scale);
                RoundRect(batch, sprites,
                          new Rectangle(box.X - ring, box.Y - ring,
                                        box.Width + ring * 2, box.Height + ring * 2),
                          2 * scale, Palette.Scrim);
                RoundRect(batch, sprites, box, 2 * scale, Palette.Accent);
                Font.DrawCentred(batch, sprites.Blank, word, box.Center.X, box.Y + pad / 2,
                                 scale, Palette.OnAccent);
            }

            y += rowH + gap;
        }

        // THE ONE NUMBER ON THE SCREEN. It is the only thing that persists between runs, so it is
        // the only thing that makes this a place you have been before rather than a splash - and it
        // says nothing at all when there is nothing banked.
        if (save.Credits > 0)
        {
            Font.DrawCentred(batch, sprites.Blank, $"{save.Credits} CREDITS BANKED", vw / 2,
                             y + 6 * scale, scale, Palette.Dim);
        }


        // THE SMALLEST THING ON THE SCREEN, and pinned to the bottom of it. 11px against the
        // tagline's 13 and the buttons' 18: it is a serial number, not a feature.
        int verScale = System.Math.Max(1, scale - 1);
        Font.DrawCentred(batch, sprites.Blank, BuildInfo.Label.ToUpperInvariant(), vw / 2,
                         vh - 10 * scale - Font.GlyphH * verScale, verScale, Palette.Faint);
    }

    public static void DrawHeroSelect(SpriteBatch batch, Sprites sprites, Settings save, int cursor,
                                      int vw, int vh)
    {
        Backdrop(batch, sprites, vw, vh);
        int scale = System.Math.Max(1, vh / 340);

        Font.DrawCentred(batch, sprites.Blank, "CHASSIS", vw / 2, (int)(vh * 0.08), scale * 2, Accent);
        Font.DrawCentred(batch, sprites.Blank,
                         $"{save.UnlockedHeroes.Count} OF {HeroUnlocks.Heroes.Length}", vw / 2,
                         (int)(vh * 0.08) + 22 * scale, scale, Dim);

        const int cols = 8;
        int cell = System.Math.Min((vw - 40) / cols, 56 * scale);
        int x0 = (vw - cell * cols) / 2;
        int y0 = (int)(vh * 0.24);

        for (int i = 0; i < HeroUnlocks.Heroes.Length; i++)
        {
            var h = HeroUnlocks.Heroes[i];
            bool owned = save.UnlockedHeroes.Contains(h.Id);
            int cx = x0 + (i % cols) * cell;
            int cy = y0 + (i / cols) * cell;

            if (i == cursor) Frame(batch, sprites, cx, cy, cell, cell);

            var tex = sprites.Get($"mech_{RenderTables.HeroSprite[i]}");
            if (tex is not null)
            {
                int pad = cell / 6;
                // THE SILHOUETTE: the same art, drawn as a shadow. A locked chassis is a shape you
                // do not have yet, not an empty box.
                batch.Draw(tex, new Rectangle(cx + pad, cy + pad, cell - pad * 2, cell - pad * 2),
                           owned ? Color.White : new Color(0, 0, 0, 190));
            }
            if (!owned)
            {
                Font.DrawCentred(batch, sprites.Blank, "?", cx + cell / 2, cy + cell / 2 - 4 * scale,
                                 scale * 2, Locked);
            }
        }

        var sel = HeroUnlocks.Heroes[cursor];
        bool selOwned = save.UnlockedHeroes.Contains(sel.Id);
        int ty = y0 + cell * 2 + 16 * scale;
        Font.DrawCentred(batch, sprites.Blank,
                         (selOwned ? sel.Name : "LOCKED").ToUpperInvariant(), vw / 2, ty, scale * 2,
                         selOwned ? Ink : Locked);

        Font.DrawCentred(batch, sprites.Blank,
                         selOwned ? "[ENTER] TAKE IT OUT" : "NOT YET EARNED",
                         vw / 2, ty + 24 * scale, scale, selOwned ? Good : Dim);
        Font.DrawCentred(batch, sprites.Blank, "[ARROWS] MOVE   [ESC] BACK", vw / 2, vh - 24 * scale,
                         scale, Dim);
    }

    // -----------------------------------------------------------------------------------------

    public static void DrawLevelSelect(SpriteBatch batch, Sprites sprites, Settings save, int cursor,
                                       int vw, int vh)
    {
        Backdrop(batch, sprites, vw, vh);
        int scale = System.Math.Max(1, vh / 340);

        Font.DrawCentred(batch, sprites.Blank, "YARD", vw / 2, (int)(vh * 0.12), scale * 2, Accent);

        int y = (int)(vh * 0.30);
        for (int i = 0; i < HeroUnlocks.Levels.Length; i++)
        {
            var l = HeroUnlocks.Levels[i];
            bool owned = save.UnlockedLevels.Contains(l.Id);
            var colour = !owned ? Locked : i == cursor ? Accent : Ink;
            string label = owned ? l.Name.ToUpperInvariant() : "? ? ?";
            Font.DrawCentred(batch, sprites.Blank, (i == cursor ? "> " : "  ") + label, vw / 2, y,
                             scale * 2, colour);
            y += 30 * scale;
        }

        Font.DrawCentred(batch, sprites.Blank, "[ARROWS] MOVE   [ENTER] TAKE IT   [ESC] BACK",
                         vw / 2, vh - 24 * scale, scale, Dim);
    }

    // -----------------------------------------------------------------------------------------

    /// <summary>
    /// The workshop: sixteen upgrades, a flat price per tier, and one purse.
    /// </summary>
    /// <remarks>
    /// EVERY TIER IS SHOWN AS PIPS rather than as "3/7". A workshop upgrade is a track you are part
    /// way along, and a fraction reads as a score - the pips are the same information as a shape you
    /// can see filling up.
    /// </remarks>
    public static void DrawWorkshop(SpriteBatch batch, Sprites sprites, Settings save, int cursor,
                                    int vw, int vh)
    {
        Backdrop(batch, sprites, vw, vh);
        int scale = System.Math.Max(1, vh / 400);

        Font.DrawCentred(batch, sprites.Blank, "WORKSHOP", vw / 2, 10 * scale, scale * 2, Accent);
        Font.DrawCentred(batch, sprites.Blank, $"{save.Credits} CREDITS", vw / 2, 32 * scale, scale,
                         Ink);

        int rowH = 16 * scale;
        int top = 50 * scale;
        int listW = System.Math.Min(vw - 40, 260 * scale);
        int x0 = (vw - listW) / 2;

        for (int i = 0; i < WorkshopText.All.Length; i++)
        {
            var def = WorkshopText.All[i];
            int owned = save.TierOf(i);
            bool maxed = owned >= def.Tiers;
            bool afford = save.CanBuy(i);
            int y = top + i * rowH;

            if (i == cursor)
            {
                batch.Draw(sprites.Blank, new Rectangle(x0 - 4, y - 2, listW + 8, rowH), Panel);
            }

            var colour = maxed ? Good : afford ? Ink : Dim;
            Font.Draw(batch, sprites.Blank, def.Name.ToUpperInvariant(), x0, y, scale, colour);

            // The tiers, as pips.
            int px = x0 + listW - def.Tiers * (5 * scale) - 50 * scale;
            for (int t = 0; t < def.Tiers; t++)
            {
                batch.Draw(sprites.Blank,
                           new Rectangle(px + t * 5 * scale, y + 2 * scale, 3 * scale, 6 * scale),
                           t < owned ? Accent : Locked);
            }

            string price = maxed ? "MAX" : $"{def.Cost}";
            Font.Draw(batch, sprites.Blank, price, x0 + listW - 40 * scale, y, scale,
                      maxed ? Good : afford ? Accent : Locked);
        }

        // The selected upgrade's blurb, which is the only place it is explained.
        var sel = WorkshopText.At(cursor);
        int by = top + WorkshopText.All.Length * rowH + 10 * scale;
        foreach (string line in Font.Wrap(sel.Blurb, listW, scale))
        {
            Font.Draw(batch, sprites.Blank, line, x0, by, scale, Dim);
            by += Font.LineHeight * scale;
        }

        Font.DrawCentred(batch, sprites.Blank,
                         "[ARROWS] MOVE   [ENTER] BUY   [R] SELL ALL BACK   [ESC] DONE",
                         vw / 2, vh - 16 * scale, scale, Dim);
    }

    // -----------------------------------------------------------------------------------------

    // -----------------------------------------------------------------------------------------


    public static void DrawSettings(SpriteBatch batch, Sprites sprites, Settings save, int cursor,
                                    int vw, int vh)
    {
        Backdrop(batch, sprites, vw, vh);
        int scale = System.Math.Max(1, vh / 400);

        Font.DrawCentred(batch, sprites.Blank, "SETTINGS", vw / 2, 14 * scale, scale * 2, Accent);

        int listW = System.Math.Min(vw - 40, 320 * scale);
        int x0 = (vw - listW) / 2;
        int y = 48 * scale;
        int rowH = 34 * scale;

        for (int i = 0; i < MenuRows.Settings.Length; i++)
        {
            if (i == cursor)
            {
                batch.Draw(sprites.Blank, new Rectangle(x0 - 4, y - 3, listW + 8, rowH - 4), Panel);
            }

            Font.Draw(batch, sprites.Blank, MenuRows.Settings[i], x0, y, scale,
                      i == cursor ? Ink : Dim);

            string value = i switch
            {
                0 => save.DprCap == 1 ? "ON" : "OFF",
                1 => save.Animations.ToUpperInvariant(),
                _ => save.Debug ? "ON" : "OFF",
            };
            // Right-aligned off the measured width rather than a glyph count: the value strings are
            // different lengths and a fixed advance would leave them ragged against the edge.
            Font.Draw(batch, sprites.Blank, value, x0 + listW - Font.Measure(value, scale), y,
                      scale, i == cursor ? Accent : Dim);

            string note = i switch
            {
                0 => "HALF RESOLUTION. TAKES EFFECT NEXT LAUNCH.",
                // The note names the platform quirk that forced three choices rather than a switch.
                1 => "CHEST REELS AND SCREEN EFFECTS. AUTO FOLLOWS THE SYSTEM.",
                _ => "FRAME TIME AND COUNTS, OVER THE HUD.",
            };
            Font.Draw(batch, sprites.Blank, note, x0, y + Font.LineHeight * scale, scale, Locked);
            y += rowH;
        }

        Font.DrawCentred(batch, sprites.Blank, "[ARROWS] CHANGE   [C] CHANGELOG   [ESC] BACK",
                         vw / 2, vh - 16 * scale, scale, Dim);
    }

    /// <summary>Rows the index shows at once, and lines a page shows at once.</summary>
    public const int PediaRows = 11;

    /// <summary>
    /// Every level the bestiary lists, paired with its display name.
    /// </summary>
    /// <remarks>
    /// FROM THE UNLOCK TABLE, which is the one place that already names every level - so a level
    /// added there appears in the manual without a second list being remembered. City Chaos ships
    /// no creatures of its own yet and simply contributes an empty group, which is what "none yet"
    /// looks like rather than an omission.
    /// </remarks>
    public static IReadOnlyList<(ILevel Level, string Name)> PlayableLevels()
    {
        var outv = new List<(ILevel, string)>();
        foreach (var l in HeroUnlocks.Levels) outv.Add((Simulation.LevelById(l.Id), l.Name));
        return outv;
    }

    /// <summary>
    /// The Scrapopedia: what every gun and every system actually does.
    /// </summary>
    /// <remarks>
    /// <para>
    /// WHY IT EXISTS GIVEN THE CARDS. A level-up card is read in four seconds with a horde closing
    /// in, which is why its text carries no numbers and says what happens rather than how much.
    /// That is the right trade at that moment and the wrong one everywhere else: the single most
    /// confusing thing in this game is that every weapon picks its target by a DIFFERENT RULE, and
    /// a card has no room to say so. This is the screen with time to explain it.
    /// </para>
    /// <para>
    /// SECTIONS, THEN INDEX, THEN PAGE - and Back walks exactly one step and never more, so the key
    /// means one thing everywhere. Three panes drawn from one variable, so the screen cannot end up
    /// showing two of them or none.
    /// </para>
    /// </remarks>
    public static void DrawPedia(SpriteBatch batch, Sprites sprites, PediaState st, int vw, int vh)
    {
        Backdrop(batch, sprites, vw, vh);
        int scale = System.Math.Max(1, vh / 400);
        int listW = System.Math.Min(vw - 40, 340 * scale);
        int x0 = (vw - listW) / 2;

        Font.DrawCentred(batch, sprites.Blank, "SCRAPOPEDIA", vw / 2, 12 * scale, scale * 2, Accent);

        if (st.Section < 0)
        {
            int y = 46 * scale;
            for (int i = 0; i < Pedia.Sections.Length; i++)
            {
                bool on = i == st.SectionCursor;
                if (on) batch.Draw(sprites.Blank, new Rectangle(x0 - 4, y - 3, listW + 8, 26 * scale), Panel);
                Font.Draw(batch, sprites.Blank, Pedia.Sections[i].Label, x0, y, scale,
                          on ? Ink : Dim);
                Font.Draw(batch, sprites.Blank, Pedia.Sections[i].Blurb, x0,
                          y + Font.LineHeight * scale, scale, Locked);
                y += 28 * scale;
            }
            Font.DrawCentred(batch, sprites.Blank, "[ARROWS] MOVE   [ENTER] OPEN   [ESC] BACK",
                             vw / 2, vh - 16 * scale, scale, Dim);
            return;
        }

        if (st.Page is null)
        {
            var rows = st.Rows;
            Font.DrawCentred(batch, sprites.Blank, Pedia.Sections[st.Section].Label, vw / 2,
                             30 * scale, scale, Dim);

            int first = System.Math.Clamp(st.RowCursor - PediaRows / 2, 0,
                                          System.Math.Max(0, rows.Count - PediaRows));
            int y = 48 * scale;
            for (int r = 0; r < PediaRows && first + r < rows.Count; r++)
            {
                var row = rows[first + r];
                bool on = first + r == st.RowCursor;

                if (row.Kind == Pedia.Kind.Heading)
                {
                    Font.Draw(batch, sprites.Blank, row.Text, x0, y, scale, Accent);
                    Font.Draw(batch, sprites.Blank, row.Sub,
                              x0 + listW - Font.Measure(row.Sub, scale), y, scale, Dim);
                }
                else
                {
                    if (on)
                    {
                        batch.Draw(sprites.Blank,
                                   new Rectangle(x0 - 4, y - 2, listW + 8, Font.LineHeight * scale + 3),
                                   Panel);
                    }
                    Font.Draw(batch, sprites.Blank, "  " + row.Text, x0, y, scale, on ? Ink : Dim);
                }
                y += (Font.LineHeight + 3) * scale;
            }

            // A GROUP WITH NOTHING IN IT IS STILL A GROUP, and it says so rather than looking
            // broken - a heading with no rows under it is what "none yet" looks like here.
            if (rows.Count <= Pedia.Sections.Length)
            {
                Font.DrawCentred(batch, sprites.Blank, "NOTHING FOUND YET", vw / 2, y + 8 * scale,
                                 scale, Locked);
            }

            Font.DrawCentred(batch, sprites.Blank, "[ARROWS] MOVE   [ENTER] OPEN   [ESC] BACK",
                             vw / 2, vh - 16 * scale, scale, Dim);
            return;
        }

        DrawPediaPage(batch, sprites, st, x0, listW, scale, vw, vh);
    }

    /// <summary>
    /// One page, wrapped to the window and scrolled a line at a time.
    /// </summary>
    /// <remarks>
    /// WRAPPED HERE RATHER THAN IN THE PAGE. The text is authored as paragraphs and the width is a
    /// property of the window, so the two meet at the last possible moment - which is what lets the
    /// same page be right on a phone-shaped window and a wide one without the content knowing.
    /// </remarks>
    private static void DrawPediaPage(SpriteBatch batch, Sprites sprites, PediaState st, int x0,
                                      int listW, int scale, int vw, int vh)
    {
        var page = st.Page!.Value;

        var icon = page.Icon == "" ? null : sprites.Get("icon_" + page.Icon);
        int headX = x0;
        if (icon is not null)
        {
            int box = 20 * scale;
            batch.Draw(icon, new Rectangle(x0, 30 * scale, box, box), Color.White);
            headX += box + 6 * scale;
        }
        Font.Draw(batch, sprites.Blank, page.Title, headX, 30 * scale, scale, Ink);
        Font.Draw(batch, sprites.Blank, page.Kind, headX, 30 * scale + Font.LineHeight * scale,
                  scale, Accent);

        var lines = st.Wrapped(listW, scale);
        int shown = PediaRows;
        int first = System.Math.Clamp(st.PageScroll, 0, System.Math.Max(0, lines.Count - shown));
        int y = 60 * scale;
        for (int i = 0; i < shown && first + i < lines.Count; i++)
        {
            string line = lines[first + i];
            // A line that opens with a hash is a section heading, which is how the page marks one
            // without the wrapper needing to know about structure.
            if (line.StartsWith('#'))
            {
                Font.Draw(batch, sprites.Blank, line[1..].Trim(), x0, y, scale, Accent);
            }
            else
            {
                Font.Draw(batch, sprites.Blank, line, x0, y, scale, Ink);
            }
            y += (Font.LineHeight + 2) * scale;
        }

        if (lines.Count > shown)
        {
            Font.DrawCentred(batch, sprites.Blank, $"{first + 1} - {System.Math.Min(first + shown, lines.Count)} OF {lines.Count}",
                             vw / 2, vh - 28 * scale, scale, Locked);
        }
        Font.DrawCentred(batch, sprites.Blank, "[ARROWS] SCROLL   [ESC] BACK", vw / 2,
                         vh - 16 * scale, scale, Dim);
    }

    // -----------------------------------------------------------------------------------------

    /// <summary>Lines the changelog shows at once.</summary>
    public const int ChangeRows = 13;

    /// <summary>
    /// The changelog.
    /// </summary>
    /// <remarks>
    /// <para>
    /// IT IS THE ONLY PLACE THE GAME TELLS ANYONE WHAT CHANGED, which is why it is worth a screen
    /// rather than a link. The entries are generated from <c>src/ui/changelog.ts</c> - the file the
    /// project's rules say to update - so there is one authored copy and it is the one people
    /// already edit.
    /// </para>
    /// <para>
    /// TIMES ARE PRINTED AS UTC, verbatim, never converted to the machine's zone. A changelog
    /// records when the REPOSITORY changed; converting would make two people comparing notes on one
    /// build read different timestamps for the same entry.
    /// </para>
    /// <para>
    /// AND IT ALWAYS OPENS AT THE NEWEST ENTRY, however far the last visit scrolled - the reason to
    /// open it is nearly always to find out what just changed.
    /// </para>
    /// </remarks>
    public static void DrawChangelog(SpriteBatch batch, Sprites sprites, List<string> lines,
                                     int scroll, int vw, int vh)
    {
        Backdrop(batch, sprites, vw, vh);
        int scale = System.Math.Max(1, vh / 400);
        int listW = System.Math.Min(vw - 40, 340 * scale);
        int x0 = (vw - listW) / 2;

        Font.DrawCentred(batch, sprites.Blank, "CHANGELOG", vw / 2, 12 * scale, scale * 2, Accent);
        string latest = Changelog.All.Length > 0
            ? "LATEST: " + Changelog.FormatTime(Changelog.All[0].At).ToUpperInvariant()
            : "NO ENTRIES YET";
        Font.DrawCentred(batch, sprites.Blank, latest, vw / 2, 32 * scale, scale, Dim);

        int first = System.Math.Clamp(scroll, 0, System.Math.Max(0, lines.Count - ChangeRows));
        int y = 50 * scale;
        for (int i = 0; i < ChangeRows && first + i < lines.Count; i++)
        {
            string line = lines[first + i];
            // The markers travel on the line, so the wrapper never needs to know about structure:
            // `@` is a timestamp, `#` a title, everything else a note.
            if (line.StartsWith('@'))
            {
                Font.Draw(batch, sprites.Blank, line[1..], x0, y, scale, Locked);
            }
            else if (line.StartsWith('#'))
            {
                Font.Draw(batch, sprites.Blank, line[1..], x0, y, scale, Accent);
            }
            else
            {
                Font.Draw(batch, sprites.Blank, line, x0, y, scale, Ink);
            }
            y += (Font.LineHeight + 2) * scale;
        }

        if (lines.Count > ChangeRows)
        {
            Font.DrawCentred(batch, sprites.Blank,
                             $"{first + 1} - {System.Math.Min(first + ChangeRows, lines.Count)} OF {lines.Count}",
                             vw / 2, vh - 28 * scale, scale, Locked);
        }
        Font.DrawCentred(batch, sprites.Blank, "[ARROWS] SCROLL   [ESC] BACK", vw / 2,
                         vh - 16 * scale, scale, Dim);
    }

    // -----------------------------------------------------------------------------------------

    public static void DrawPause(SpriteBatch batch, Sprites sprites, World w, int cursor,
                                 int vw, int vh)
    {
        batch.Draw(sprites.Blank, new Rectangle(0, 0, vw, vh), new Color(0, 0, 0, 200));
        int scale = System.Math.Max(1, vh / 340);

        Font.DrawCentred(batch, sprites.Blank, "PAUSED", vw / 2, (int)(vh * 0.30), scale * 3, Accent);

        int mins = (int)(w.RunSec / 60);
        int secs = (int)(w.RunSec % 60);
        int y = (int)(vh * 0.30) + 40 * scale;
        Font.DrawCentred(batch, sprites.Blank,
                         $"{mins}:{secs:00}   LV {w.Player.Level}   x{w.Stats.Kills:0}", vw / 2, y,
                         scale, Dim);

        y += 30 * scale;
        Menu(batch, sprites, vw, ref y, scale, MenuRows.Pause(), cursor);

        // WHAT IS BEING CARRIED, which is the other reason a player pauses. The card text says what
        // a weapon does; this says what is actually on the mech and at what tier, which is the
        // question the level-up screen keeps asking and nothing else answers.
        //
        // NAMED AT THEIR CURRENT TIER, so an ascended gun reads as what it became.
        y += 18 * scale;
        for (int kind = 0; kind < 2; kind++)
        {
            var held = new List<string>();
            for (int i = 0; i < w.UpgradeDefs.Length && i < CardTexts.All.Length; i++)
            {
                int stacks = w.LevelUp.Stacks[i];
                if (stacks <= 0) continue;
                bool weapon = w.UpgradeDefs[i].Kind == UpgradeKind.Weapon;
                if (weapon != (kind == 0)) continue;

                var card = CardTexts.At(i);
                string name = stacks >= UpgradeCatalog.WeaponAscendedTier
                              && PediaText.AscensionOf(card.Id) is { } asc
                    ? asc.Name
                    : card.Name;
                held.Add($"{name.ToUpperInvariant()} {stacks}");
            }

            Font.DrawCentred(batch, sprites.Blank, kind == 0 ? "WEAPONS" : "PASSIVES", vw / 2, y,
                             scale, Accent);
            y += Font.LineHeight * scale + 2;

            // EMPTY IS SAID RATHER THAN LEFT BLANK. A heading with nothing under it reads as a
            // panel that failed to load; "none" reads as an answer.
            if (held.Count == 0)
            {
                Font.DrawCentred(batch, sprites.Blank, "NONE", vw / 2, y, scale, Locked);
                y += Font.LineHeight * scale + 2;
            }
            foreach (string h in held)
            {
                Font.DrawCentred(batch, sprites.Blank, h, vw / 2, y, scale, Ink);
                y += Font.LineHeight * scale + 2;
            }
            y += 6 * scale;
        }

        // ABANDONING IS SAFE, and saying so matters: the banking rule means everything earned is
        // already in the save. A player who does not know that will keep playing a run they are not
        // enjoying to protect progress they already have.
        Font.DrawCentred(batch, sprites.Blank, "EVERYTHING EARNED IS ALREADY BANKED", vw / 2,
                         vh - 24 * scale, scale, Dim);
    }

    // -----------------------------------------------------------------------------------------

    /// <summary>
    /// A list of rows, with the cursor on one of them.
    /// </summary>
    /// <remarks>
    /// A DISABLED ROW IS SHOWN AND NOT SKIPPED. "Yard" greyed out is the game saying a second map
    /// exists and has not been earned; removing the row would say nothing at all, and the cursor
    /// steps over it so it can never be chosen.
    /// </remarks>
    private static void Menu(SpriteBatch batch, Sprites sprites, int vw, ref int y, int scale,
                             MenuRows.MenuRow[] rows, int cursor)
    {
        for (int i = 0; i < rows.Length; i++)
        {
            var row = rows[i];
            string text = $"{row.Key}  {row.Label}";
            int w = Font.Measure(text, scale);
            int x = (vw - w) / 2;

            if (i == cursor)
            {
                batch.Draw(sprites.Blank,
                           new Rectangle(x - 6 * scale, y - 2 * scale,
                                         w + 12 * scale, Font.LineHeight * scale + 4 * scale),
                           Panel);
            }

            Font.Draw(batch, sprites.Blank, text, x, y,
                      scale, !row.Enabled ? Locked : i == cursor ? Accent : Ink);
            y += (Font.LineHeight + 6) * scale;
        }
    }

    /// <summary>The menu ground: the floor tile, dimmed, so a menu is somewhere rather than nowhere.</summary>
    /// <summary>
    /// A filled rounded rectangle, drawn as horizontal slices.
    /// </summary>
    /// <remarks>
    /// <para>
    /// THE BUTTONS ARE SOLID, not outlines. The port drew them as hairline frames, which reads as a
    /// wireframe of a menu rather than a menu - the web build fills them, and the fill is most of
    /// what makes a button look pressable.
    /// </para>
    /// <para>
    /// SLICED RATHER THAN TEXTURED. There is one 1x1 white pixel to draw with, so the corner is a
    /// row-by-row inset off a circle: a couple of dozen quads for a button, which is nothing beside
    /// the horde and avoids carrying a nine-slice texture for four rectangles.
    /// </para>
    /// </remarks>
    private static void RoundRect(SpriteBatch batch, Sprites sprites, Rectangle r, int radius,
                                  Color colour)
    {
        int rad = System.Math.Min(radius, System.Math.Min(r.Width, r.Height) / 2);
        if (rad <= 0)
        {
            batch.Draw(sprites.Blank, r, colour);
            return;
        }

        batch.Draw(sprites.Blank,
                   new Rectangle(r.X, r.Y + rad, r.Width, r.Height - rad * 2), colour);

        for (int i = 0; i < rad; i++)
        {
            // How far in this row starts, off the quarter circle.
            double dy = rad - i - 0.5;
            int inset = rad - (int)System.Math.Round(System.Math.Sqrt(rad * rad - dy * dy));
            int w = r.Width - inset * 2;
            if (w <= 0) continue;
            batch.Draw(sprites.Blank, new Rectangle(r.X + inset, r.Y + i, w, 1), colour);
            batch.Draw(sprites.Blank,
                       new Rectangle(r.X + inset, r.Y + r.Height - 1 - i, w, 1), colour);
        }
    }

    /// <summary>One menu button: a fill, an outline, and a centred label.</summary>
    /// <remarks>
    /// NO KEY IS PRINTED ON IT. The web build's buttons carry their label and nothing else, and the
    /// port drew a "[ENTER]" over on the left that the centred label ran straight through. The
    /// letter shortcuts still work; they are a convenience for hands already on a keyboard rather
    /// than the way in, which is the cursor.
    /// </remarks>
    private static void Button(SpriteBatch batch, Sprites sprites, Rectangle r, string label,
                               int scale, bool primary, bool cursor)
    {
        int radius = 7 * scale;
        RoundRect(batch, sprites, r, radius, primary ? Palette.Accent : Palette.Button);

        // THE CURSOR IS A BRIGHTER EDGE rather than a different fill, so a pad user can see where
        // they are without the row changing what it is.
        if (cursor)
        {
            RoundRect(batch, sprites, r, radius, Palette.Accent * (primary ? 0.25f : 0.35f));
        }

        Font.DrawCentred(batch, sprites.Blank, label, r.Center.X,
                         r.Y + (r.Height - Font.GlyphH * scale) / 2, scale,
                         primary ? Palette.OnAccent : Palette.Ink);
    }

    /// <summary>The ground every out-of-run menu sits on.</summary>
    /// <remarks>
    /// NOT THE YARD. The port tiled the floor sprite here and scrimmed it, which put every menu on
    /// warm rust; the web build's canvas is BLANK on these screens, because the simulation is not
    /// running yet. What is behind a title screen is black, and the overlay's own
    /// rgba(6, 9, 13, 0.86) over black is the near-black the chrome was coloured against.
    ///
    /// The two draws are kept apart rather than folded into one constant so the arithmetic stays
    /// legible: this is a scrim over an empty canvas, and it is the SAME scrim the in-run overlays
    /// put over a live frame - where the yard showing through is the point.
    /// </remarks>
    private static void Backdrop(SpriteBatch batch, Sprites sprites, int vw, int vh)
    {
        var all = new Rectangle(0, 0, vw, vh);
        batch.Draw(sprites.Blank, all, Color.Black);
        batch.Draw(sprites.Blank, all, Palette.Scrim);
    }

    private static void Frame(SpriteBatch batch, Sprites sprites, int x, int y, int w, int h)
    {
        batch.Draw(sprites.Blank, new Rectangle(x, y, w, 2), Edge);
        batch.Draw(sprites.Blank, new Rectangle(x, y + h - 2, w, 2), Edge);
        batch.Draw(sprites.Blank, new Rectangle(x, y, 2, h), Edge);
        batch.Draw(sprites.Blank, new Rectangle(x + w - 2, y, 2, h), Edge);
    }

    private static string NameOfLevel(string id)
    {
        foreach (var l in HeroUnlocks.Levels)
        {
            if (l.Id == id) return l.Name;
        }
        return id;
    }
}
