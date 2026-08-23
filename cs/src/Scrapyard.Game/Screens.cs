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

    /// <summary>
    /// The chassis roster: sixteen tiles, two across, most of them silhouettes.
    /// </summary>
    /// <remarks>
    /// <para>
    /// A LOCKED CHASSIS IS A SHAPE YOU DO NOT HAVE YET, not an empty box. It is the same art drawn
    /// as a shadow, with a question mark ON it - so the roster reads as sixteen mechs, fourteen of
    /// them out of reach, rather than as two mechs and fourteen holes. That is the whole reason the
    /// screen shows every chassis from the first run instead of growing.
    /// </para>
    /// <para>
    /// AND THE CRITERIA ARE PUBLISHED NOWHERE. A silhouette and a question mark is all a locked tile
    /// ever says; the achievement that fires on earning it states the condition afterwards, in the
    /// past tense. There is deliberately no imperative version of that text anywhere in the game.
    /// </para>
    /// </remarks>
    public static void DrawHeroSelect(SpriteBatch batch, Sprites sprites, Settings save, int cursor,
                                      int vw, int vh)
    {
        Backdrop(batch, sprites, vw, vh);
        int scale = System.Math.Max(1, vh / 300);
        int small = System.Math.Max(1, scale - 1);
        int w = Column(vw, scale);
        int x0 = (vw - w) / 2;

        int y = Head(batch, sprites, "NEW GAME", "PICK A MECH", vw, 8 * scale, scale);
        Font.DrawCentred(batch, sprites.Blank,
                         "SIXTEEN CHASSIS. EIGHT CARRY A BONUS TO ONE WEAPON.", vw / 2, y, small,
                         Palette.Faint);
        y += Font.LineHeight * small + 6 * scale;

        int actionsY = Actions(batch, sprites, vw, vh, scale, "BACK", "ESC", "NEXT", "ENTER");

        // --- the grid -------------------------------------------------------------------------
        var roster = HeroUnlocks.Heroes;
        int gap = 4 * scale;
        int cols = 2;
        int tileW = (w - gap * (cols - 1)) / cols;
        int radius = 7 * scale;
        int thick = System.Math.Max(1, scale / 2);

        // EACH GRID ROW IS AS TALL AS THE TALLER OF ITS TWO TILES, and no taller. That is what
        // `grid-auto-rows: max-content` gives the web build, and the rule matters in both
        // directions: sizing every row to the LONGEST identity in the roster wastes a third of the
        // screen on the short ones, and letting a row squeeze to its minimum lets the identity text
        // overflow the border - invisible at eight chassis, obvious at sixteen.
        int art = 37 * scale;
        int nRows = (roster.Length + cols - 1) / cols;
        var rowH = new int[nRows];
        for (int i = 0; i < roster.Length; i++)
        {
            // A LOCKED TILE IS ONE CHILD, not three: no name and no identity, just the silhouette.
            // Sizing it as though it carried them is what `.hero--locked { justify-content: center }`
            // is there to stop - a row whose height comes from an unlocked neighbour's full stat
            // block leaves the silhouette hanging off the top edge with a tile of nothing under it.
            int h0 = 5 * scale + art + 6 * scale;
            if (save.UnlockedHeroes.Contains(roster[i].Id))
            {
                int n = Font.Wrap(roster[i].Line.ToUpperInvariant(), tileW - 6 * scale, small).Count;
                h0 += 4 * scale + Font.GlyphH * small + 3 * scale + Font.LineHeight * small * n;
            }
            if (h0 > rowH[i / cols]) rowH[i / cols] = h0;
        }

        // The window follows the cursor a ROW at a time - a grid that scrolled by tiles would put
        // the two halves of a row on different pages. It scrolls only far enough to bring the
        // cursor's row on screen, so moving back up walks the list back rather than jumping.
        int bottom = actionsY - 8 * scale - Font.GlyphH * small;
        int cursorRow = cursor / cols;
        int firstRow = 0;
        while (firstRow < cursorRow)
        {
            int sum = 0;
            for (int rr = firstRow; rr <= cursorRow; rr++) sum += rowH[rr] + gap;
            if (sum <= bottom - y) break;
            firstRow++;
        }

        int rowTop = y;
        for (int i = firstRow * cols; i < roster.Length; i++)
        {
            int row = i / cols;
            int ry = rowTop;
            for (int rr = firstRow; rr < row; rr++) ry += rowH[rr] + gap;
            // A ROW THAT DOES NOT FIT WHOLE IS NOT DRAWN AT ALL. There is no scissor rectangle
            // here, so half a tile would be half a tile with its text running off the bottom of the
            // screen - and a chassis whose identity is cut in two is worse than one you scroll to.
            if (ry + rowH[row] > bottom) break;

            var h = roster[i];
            bool owned = save.UnlockedHeroes.Contains(h.Id);
            var r = new Rectangle(x0 + (i % cols) * (tileW + gap), ry, tileW, rowH[row]);

            if (i == cursor) Cursor(batch, sprites, r, radius, thick * 2);
            Card(batch, sprites, r, radius,
                 i == cursor ? Palette.Button : Palette.Panel, Palette.Edge, thick);

            var tex = owned ? sprites.Get(h.Art) : sprites.Silhouette(h.Art);
            if (tex is not null)
            {
                // THE ART FACES +X and nose-up reads better in a grid than nose-right, which is what
                // `transform: rotate(-90deg)` is doing on the web tile. A quarter turn about the
                // sprite's own centre - the rectangle stays square, so the two are interchangeable.
                var box = new Rectangle(r.X + (tileW - art) / 2 + art / 2, r.Y + 5 * scale + art / 2,
                                        art, art);
                batch.Draw(tex, box, null, Color.White,
                           -MathHelper.PiOver2, new Vector2(tex.Width / 2f, tex.Height / 2f),
                           SpriteEffects.None, 0f);
            }

            int ty = r.Y + 5 * scale + art + 4 * scale;
            if (owned)
            {
                Font.DrawCentred(batch, sprites.Blank, h.Name.ToUpperInvariant(), r.Center.X, ty,
                                 small, Palette.Ink);
                ty += Font.GlyphH * small + 3 * scale;
                foreach (string line in Font.Wrap(h.Line.ToUpperInvariant(), tileW - 6 * scale, small))
                {
                    Font.DrawCentred(batch, sprites.Blank, line, r.Center.X, ty, small,
                                     Palette.Faint);
                    ty += Font.LineHeight * small;
                }
            }
            else
            {
                // FULL-STRENGTH INK ON THE SILHOUETTE, and a dark halo under it. A grey mark on a
                // grey shape is the one place on this screen where contrast has to be deliberate -
                // without the halo the question mark reads as a hole in the mech.
                int qx = r.X + tileW / 2;
                int qy = r.Y + 5 * scale + (art - Font.GlyphH * scale * 2) / 2;
                for (int dx = -1; dx <= 1; dx++)
                {
                    for (int dy = -1; dy <= 1; dy++)
                    {
                        if (dx == 0 && dy == 0) continue;
                        Font.DrawCentred(batch, sprites.Blank, "?", qx + dx * scale, qy + dy * scale,
                                         scale * 2, Color.Black * 0.9f);
                    }
                }
                Font.DrawCentred(batch, sprites.Blank, "?", qx, qy, scale * 2, Palette.Ink);
            }
        }

        // THE ONE NUMBER THAT PERSISTS, said here as well as on the title because this is the screen
        // a player reaches on the way into a run - and the workshop is one button back.
        Font.DrawCentred(batch, sprites.Blank, save.Credits + " CREDITS BANKED", vw / 2,
                         actionsY - 6 * scale - Font.GlyphH * small, small, Palette.Dim);
    }

    // -----------------------------------------------------------------------------------------

    /// <summary>
    /// The yards: three of them, and two locked behind winning the one before.
    /// </summary>
    /// <remarks>
    /// A LOCKED YARD KEEPS ITS NAME AND LOSES ITS BLURB, which is the opposite of the chassis
    /// roster and deliberate. There are three of these and they are a sequence: knowing that Mossy
    /// Mayhem is next is the reason to finish the Scrapyard, and hiding it would hide the ladder.
    /// What it is LIKE is the reward.
    /// </remarks>
    public static void DrawLevelSelect(SpriteBatch batch, Sprites sprites, Settings save, int cursor,
                                       int vw, int vh)
    {
        Backdrop(batch, sprites, vw, vh);
        int scale = System.Math.Max(1, vh / 300);
        int small = System.Math.Max(1, scale - 1);
        int w = Column(vw, scale);
        int x0 = (vw - w) / 2;

        int y = Head(batch, sprites, "NEW GAME", "CHOOSE A YARD", vw, 12 * scale, scale);
        Actions(batch, sprites, vw, vh, scale, "BACK", "ESC", "DEPLOY", "ENTER");

        int pad = 7 * scale;
        int radius = 8 * scale;
        int thick = System.Math.Max(1, scale / 2);
        int art = 42 * scale;

        for (int i = 0; i < HeroUnlocks.Levels.Length; i++)
        {
            var l = HeroUnlocks.Levels[i];
            bool open = save.UnlockedLevels.Contains(l.Id) && l.Playable;
            int textW = w - pad * 3 - art;

            var blurb = open ? Font.Wrap(l.Line.ToUpperInvariant(), textW, small)
                             : (IReadOnlyList<string>)System.Array.Empty<string>();
            int h = System.Math.Max(art, Font.GlyphH * scale + 4 * scale
                                         + Font.LineHeight * small * blurb.Count) + pad * 2;
            var r = new Rectangle(x0, y, w, h);

            if (i == cursor) Cursor(batch, sprites, r, radius, thick * 2);
            Card(batch, sprites, r, radius, Palette.Panel, Palette.Edge, thick);

            // The art sits in a well rather than on the card - a darker box the picture is inside,
            // which is what `.level__art { background: #0a0d12 }` is for.
            var well = new Rectangle(r.X + pad, r.Y + (h - art) / 2, art, art);
            RoundRect(batch, sprites, well, 6 * scale, Palette.Sunken);
            var tex = open ? sprites.Get(l.Art) : sprites.Silhouette(l.Art);
            if (tex is not null)
            {
                int inner = art * 78 / 100;
                batch.Draw(tex,
                           new Rectangle(well.X + (art - inner) / 2, well.Y + (art - inner) / 2,
                                         inner, inner), Color.White);
            }

            int tx = well.Right + pad;
            int ty = r.Y + (h - (Font.GlyphH * scale + 4 * scale
                                 + Font.LineHeight * small * blurb.Count)) / 2;
            Font.Draw(batch, sprites.Blank, l.Name.ToUpperInvariant(), tx, ty, scale,
                      open ? Palette.Ink : Palette.Locked);
            ty += Font.GlyphH * scale + 4 * scale;
            foreach (string line in blurb)
            {
                Font.Draw(batch, sprites.Blank, line, tx, ty, small, Palette.Faint);
                ty += Font.LineHeight * small;
            }

            // TBD AND LOCKED ARE DIFFERENT ANSWERS. One says the yard is not built; the other says
            // it is built and you have not earned it. Telling a player to go and win something that
            // does not exist yet is worse than saying nothing.
            if (!open)
            {
                string flag = !l.Playable ? "TBD" : "LOCKED";
                int fw = Font.Measure(flag, small) + 5 * scale;
                var box = new Rectangle(r.Right - pad - fw, r.Y + pad,
                                        fw, Font.GlyphH * small + 4 * scale);
                Card(batch, sprites, box, 3 * scale, Palette.Sunken, Palette.Edge, thick);
                Font.DrawCentred(batch, sprites.Blank, flag, box.Center.X, box.Y + 2 * scale, small,
                                 Palette.Faint);
            }

            y += h + 6 * scale;
        }
    }

    // -----------------------------------------------------------------------------------------

    /// <summary>
    /// The workshop: sixteen upgrades, a flat price per tier, and one purse.
    /// </summary>
    /// <remarks>
    /// <para>
    /// EVERY TIER IS SHOWN AS PIPS rather than as "3 of 7". A ladder's length is the thing worth
    /// seeing at a glance - how much is left is a shape, not a fraction - and it is the same reading
    /// whether the ladder is one tier long or seven.
    /// </para>
    /// <para>
    /// AND THE ROW SAYS WHAT IT DOES TO YOUR MECH, in numbers. This is the one screen in the game
    /// where magnitudes belong: an upgrade card is read in four seconds with a horde closing in, and
    /// this is read between runs with nothing chasing you, deciding where fifty credits go. The
    /// figure IS the question here, and a card would be worse for carrying it.
    /// </para>
    /// <para>
    /// THE WORKSHOP IS BLUE, not gold. Gold means "a decision, now" everywhere else in the game -
    /// the level-up card, the primary button, the thing under the cursor. Money already earned being
    /// spent between runs is a different kind of decision and gets a different colour.
    /// </para>
    /// </remarks>
    public static void DrawWorkshop(SpriteBatch batch, Sprites sprites, Settings save, int cursor,
                                    int vw, int vh)
    {
        Backdrop(batch, sprites, vw, vh);
        int scale = System.Math.Max(1, vh / 300);
        int small = System.Math.Max(1, scale - 1);
        int w = Column(vw, scale);
        int x0 = (vw - w) / 2;

        int y = Head(batch, sprites, "BETWEEN RUNS", "WORKSHOP", vw, 10 * scale, scale);

        // THE TOTAL IS THE BIGGEST THING ON THE SCREEN, because it is what every one of the sixteen
        // decisions below is measured against - and it stays put while the list scrolls, so a player
        // at the bottom of the list does not have to come back up to find out what they can afford.
        string credits = save.Credits.ToString();
        Font.DrawCentred(batch, sprites.Blank, credits, vw / 2, y, scale * 3, Palette.Shop);
        y += Font.GlyphH * scale * 3 + 4 * scale;
        Font.DrawCentred(batch, sprites.Blank, Spaced("CREDITS BANKED"), vw / 2, y, small,
                         Palette.Faint);
        y += Font.LineHeight * small + 6 * scale;

        // The buttons first: the list is what gives up room, not the way out of the screen.
        long spent = save.TotalSpent();
        int btnH = 27 * scale;
        int refundH = 23 * scale;
        int backY = vh - 12 * scale - btnH;
        int refundY = backY - 5 * scale - refundH;

        ActionButton(batch, sprites, new Rectangle(x0, refundY, w, refundH),
                     spent > 0 ? "REFUND ALL (" + spent + " CR)" : "NOTHING TO REFUND", "R", scale,
                     false);
        ActionButton(batch, sprites, new Rectangle(x0, backY, w, btnH), "BACK", "ESC", scale, true);

        // --- the list -------------------------------------------------------------------------
        int pad = 6 * scale;
        int radius = 7 * scale;
        int thick = System.Math.Max(1, scale / 2);
        int stripe = 2 * scale;
        int buyW = 42 * scale;
        int gap = 5 * scale;
        int bottom = refundY - 6 * scale;
        int avail = bottom - y;

        var heights = new int[WorkshopText.All.Length];
        for (int i = 0; i < heights.Length; i++)
        {
            heights[i] = RowHeight(WorkshopText.All[i], save.TierOf(i), w, buyW, pad, stripe, scale,
                                   small);
        }

        // WHERE THE WINDOW STARTS IS RECOMPUTED, not remembered. The rows are different heights - a
        // four-line blurb beside a one-liner - so a scroll offset in pixels would have to be kept in
        // step with the cursor anyway, and the cursor is the only thing that actually HAS to be on
        // screen. The smallest start that shows it is the answer, and it costs sixteen additions.
        int first = 0;
        while (first < cursor)
        {
            int sum = 0;
            for (int i = first; i <= cursor; i++) sum += heights[i] + gap;
            if (sum <= avail) break;
            first++;
        }

        for (int i = first; i < WorkshopText.All.Length; i++)
        {
            if (y + heights[i] > bottom) break;
            var def = WorkshopText.All[i];
            int owned = save.TierOf(i);
            bool full = owned >= def.Tiers;
            var r = new Rectangle(x0, y, w, heights[i]);

            if (i == cursor) Cursor(batch, sprites, r, radius, thick * 2);
            Card(batch, sprites, r, radius, Palette.Panel, Palette.Edge, thick);

            // MAXED READS AS DONE RATHER THAN AS DISABLED: the row keeps its text and loses its
            // colour, which is what `.upgrades__row--full` does by swapping the stripe to faint ink.
            batch.Draw(sprites.Blank,
                       new Rectangle(r.X, r.Y + radius, stripe, r.Height - radius * 2),
                       full ? Palette.Faint : Palette.Shop);

            int tx = r.X + stripe + pad;
            int textW = r.Width - stripe - pad * 3 - buyW;
            int ty = r.Y + pad;

            Font.Draw(batch, sprites.Blank, def.Name.ToUpperInvariant(), tx, ty, scale, Palette.Ink);
            ty += Font.GlyphH * scale + 3 * scale;

            foreach (string line in Font.Wrap(def.Blurb.ToUpperInvariant(), textW, small))
            {
                Font.Draw(batch, sprites.Blank, line, tx, ty, small, Palette.Dim);
                ty += Font.LineHeight * small;
            }
            ty += 2 * scale;

            // A row that owns none of it has no current effect to state, so the PROMISE is the whole
            // line - and it is faint, because it is the one row state where this text is not
            // describing your mech.
            foreach (string line in Font.Wrap(SummaryOf(def, owned), textW, small))
            {
                Font.Draw(batch, sprites.Blank, line, tx, ty, small,
                          owned <= 0 ? Palette.Faint : Palette.Shop);
                ty += Font.LineHeight * small;
            }
            ty += 3 * scale;

            for (int t = 0; t < def.Tiers; t++)
            {
                RoundRect(batch, sprites,
                          new Rectangle(tx + t * 9 * scale, ty, 7 * scale, 3 * scale), scale,
                          t < owned ? Palette.Shop : Palette.Edge);
            }

            BuyButton(batch, sprites,
                      new Rectangle(r.Right - pad - buyW, r.Y + (r.Height - 22 * scale) / 2, buyW,
                                    22 * scale),
                      def, full, save.CanBuy(i), i == cursor, scale, small);

            y += heights[i] + gap;
        }
    }

    /// <summary>What a workshop row says about the mech, given what is owned of it.</summary>
    /// <remarks>
    /// THE TAIL DROPS THE NOUN THE HEAD JUST SAID - a part-bought row reads "+12.9% DAMAGE / +30% AT
    /// FULL" rather than saying "damage" twice in nine words. It is one line on a phone either way,
    /// and the repetition read as a stutter.
    /// </remarks>
    private static string SummaryOf(WorkshopEntry def, int owned)
    {
        if (owned <= 0) return def.Promise.ToUpperInvariant();
        string now = def.SummaryAt(owned).ToUpperInvariant();
        if (owned >= def.Tiers) return now;
        return now + "  " + def.FullBare.ToUpperInvariant() + " AT FULL";
    }

    /// <summary>How tall one workshop row has to be to hold what is in it.</summary>
    /// <remarks>
    /// MEASURED TWICE - here, and again while drawing - rather than measured once and cached. The
    /// scroll window has to know every row's height BEFORE it can decide which rows to draw, and a
    /// cache would be a field on a static drawing class outliving the save it was computed from.
    /// Wrapping sixteen short strings is not the expensive thing on this screen.
    /// </remarks>
    private static int RowHeight(WorkshopEntry def, int owned, int w, int buyW, int pad, int stripe,
                                 int scale, int small)
    {
        int textW = w - stripe - pad * 3 - buyW;
        int h = pad + Font.GlyphH * scale + 3 * scale;
        h += Font.Wrap(def.Blurb.ToUpperInvariant(), textW, small).Count * Font.LineHeight * small;
        h += 2 * scale;
        h += Font.Wrap(SummaryOf(def, owned), textW, small).Count * Font.LineHeight * small;
        h += 3 * scale + 3 * scale + pad;

        return System.Math.Max(h, 22 * scale + pad * 2);
    }

    /// <summary>The price, as a button.</summary>
    /// <remarks>
    /// A PRICE YOU CANNOT MEET STAYS LEGIBLE rather than fading out. The number is the information -
    /// a greyed-out button whose text cannot be read tells you nothing about what to save for - so
    /// `.upgrades__buy:disabled` sets `opacity: 1` and dims the ink instead.
    ///
    /// THE ACCENT FILL IS THE PORT'S, and only under the cursor. The web build's buy button is
    /// pressed with a thumb already on it; a pad needs to know which of sixteen rows ENTER is about
    /// to spend fifty credits on, and gold is what that means everywhere else here.
    /// </remarks>
    private static void BuyButton(SpriteBatch batch, Sprites sprites, Rectangle r, WorkshopEntry def,
                                  bool full, bool afford, bool cursor, int scale, int small)
    {
        bool lit = afford && cursor;
        Card(batch, sprites, r, 6 * scale, lit ? Palette.Accent : Palette.Button,
             lit ? Palette.Accent : Palette.Edge, System.Math.Max(1, scale / 2));

        if (full)
        {
            Font.DrawCentred(batch, sprites.Blank, "MAXED", r.Center.X,
                             r.Y + (r.Height - Font.GlyphH * small) / 2, small, Palette.Faint);
            return;
        }

        var ink = lit ? Palette.OnAccent : afford ? Palette.Ink : Palette.Faint;
        int block = Font.GlyphH * scale + Font.LineHeight * small;
        int top = r.Y + (r.Height - block) / 2;
        Font.DrawCentred(batch, sprites.Blank, def.Cost.ToString(), r.Center.X, top, scale, ink);
        Font.DrawCentred(batch, sprites.Blank, lit ? "ENTER" : "CR", r.Center.X,
                         top + Font.GlyphH * scale + 2 * scale, small,
                         lit ? Palette.OnAccent : Palette.Faint);
    }

    // -----------------------------------------------------------------------------------------

    /// <summary>
    /// The width every menu lays its content out in.
    /// </summary>
    /// <remarks>
    /// <para>
    /// A PHONE'S COLUMN, on whatever screen this is. The web build's overlays are full-width with
    /// twelve pixels of padding and no cap, so on a desktop browser a settings row is seventeen
    /// hundred pixels of hairline with a switch marooned at the far end. That is not what the screen
    /// was DESIGNED against: every number in the stylesheet - a 340-wide button, a 74-pixel chassis
    /// portrait, a 52-pixel switch - was chosen for a ~366px column on a handset, and the layout
    /// only reads as intended at that proportion.
    /// </para>
    /// <para>
    /// So the port caps it and centres it. Copying the desktop behaviour faithfully would reproduce
    /// a shortcoming of the original rather than the original.
    /// </para>
    /// </remarks>
    private static int Column(int vw, int scale) =>
        System.Math.Min(vw - 24 * scale, 190 * scale);

    /// <summary>Two buttons across the bottom of a menu, the right one primary.</summary>
    /// <returns>The y they start at, so a list above can stop there.</returns>
    /// <remarks>
    /// THE KEY IS PRINTED ON THESE and is not printed on the title's. The title's buttons are rows
    /// the cursor walks through and pressing a key is one way of many; these sit outside the list,
    /// cannot be walked to, and a button nothing says how to reach is a button that does not exist.
    /// It is set faint and right-aligned so the label still reads as the label.
    /// </remarks>
    private static int Actions(SpriteBatch batch, Sprites sprites, int vw, int vh, int scale,
                               string leftLabel, string leftKey, string rightLabel, string rightKey)
    {
        int w = Column(vw, scale);
        int x0 = (vw - w) / 2;
        int h = 27 * scale;
        int gap = 5 * scale;
        int y = vh - 12 * scale - h;

        // The left button is sized to its own words plus the padding `.btn:first-child` asks for;
        // the right one takes what is left, which is what `flex: 1 1 auto` beside `flex: 0 0 auto`
        // comes to.
        int leftW = Font.Measure(leftLabel, scale) + Font.Measure(leftKey, scale) + 24 * scale;
        leftW = System.Math.Min(leftW, w - 40 * scale);

        ActionButton(batch, sprites, new Rectangle(x0, y, leftW, h), leftLabel, leftKey, scale, false);
        ActionButton(batch, sprites, new Rectangle(x0 + leftW + gap, y, w - leftW - gap, h),
                     rightLabel, rightKey, scale, true);
        return y;
    }

    private static void ActionButton(SpriteBatch batch, Sprites sprites, Rectangle r, string label,
                                     string key, int scale, bool primary)
    {
        int radius = 7 * scale;
        Card(batch, sprites, r, radius, primary ? Palette.Accent : Palette.Button,
             primary ? Palette.Accent : Palette.Edge, System.Math.Max(1, scale / 2));

        int small = System.Math.Max(1, scale - 1);
        int keyW = Font.Measure(key, small);
        Font.DrawCentred(batch, sprites.Blank, label, r.Center.X - keyW / 2,
                         r.Y + (r.Height - Font.GlyphH * scale) / 2, scale,
                         primary ? Palette.OnAccent : Palette.Ink);
        Font.Draw(batch, sprites.Blank, key, r.Right - keyW - 7 * scale,
                  r.Y + (r.Height - Font.GlyphH * small) / 2, small,
                  primary ? Palette.OnAccent * 0.65f : Palette.Faint);
    }

    /// <summary>
    /// Settings: three rows, each a card with its own control.
    /// </summary>
    /// <remarks>
    /// THE NOTE IS THE POINT OF THE ROW. Two of these three settings are about a device rather than
    /// about the game - half resolution "takes effect next launch", and Auto follows a system
    /// preference that on Windows is really about window animations - and a switch with a name and
    /// no explanation invites a player to flip it and wonder why nothing happened. The web build
    /// gives every row a `.setting__note`, and it is not decoration.
    /// </remarks>
    public static void DrawSettings(SpriteBatch batch, Sprites sprites, Settings save, int cursor,
                                    int vw, int vh)
    {
        Backdrop(batch, sprites, vw, vh);
        int scale = System.Math.Max(1, vh / 300);
        int small = System.Math.Max(1, scale - 1);

        int y = Head(batch, sprites, "OPTIONS", "SETTINGS", vw, 12 * scale, scale);
        Actions(batch, sprites, vw, vh, scale, "CHANGELOG", "C", "BACK", "ESC");

        int w = Column(vw, scale);
        int x0 = (vw - w) / 2;
        int pad = 7 * scale;
        int radius = 8 * scale;
        int thick = System.Math.Max(1, scale / 2);

        for (int i = 0; i < MenuRows.Settings.Length; i++)
        {
            // The control comes first because it sets the row's height and the width the words get
            // to wrap in - the card is sized around its contents, not the other way about.
            bool segmented = i == 1;
            int ctrlW = segmented ? 42 * scale : 26 * scale;
            int ctrlH = segmented ? 22 * scale : 16 * scale;

            int textW = w - pad * 2 - ctrlW - pad;
            var note = Font.Wrap(SettingNote(i), textW, small);
            int textH = Font.GlyphH * scale + 4 * scale + Font.LineHeight * small * note.Count;
            int rowH = System.Math.Max(textH, ctrlH) + pad * 2;

            var r = new Rectangle(x0, y, w, rowH);
            if (i == cursor) Cursor(batch, sprites, r, radius, thick * 2);
            Card(batch, sprites, r, radius, Palette.Panel, Palette.Edge, thick);

            Font.Draw(batch, sprites.Blank, MenuRows.Settings[i], r.X + pad, r.Y + pad, scale,
                      Palette.Ink);
            int ny = r.Y + pad + Font.GlyphH * scale + 4 * scale;
            foreach (string line in note)
            {
                Font.Draw(batch, sprites.Blank, line, r.X + pad, ny, small, Palette.Faint);
                ny += Font.LineHeight * small;
            }

            var ctrl = new Rectangle(r.Right - pad - ctrlW, r.Y + (rowH - ctrlH) / 2, ctrlW, ctrlH);
            if (segmented)
            {
                int chosen = save.Animations switch { "on" => 1, "off" => 2, _ => 0 };
                Segmented(batch, sprites, ctrl, new[] { "A", "ON", "OFF" }, chosen, small);
            }
            else
            {
                Pill(batch, sprites, ctrl, i == 0 ? save.DprCap == 1 : save.Debug);
            }

            y += rowH + 5 * scale;
        }
    }

    private static string SettingNote(int i) => i switch
    {
        0 => "RENDERS AT HALF RESOLUTION. TAKES EFFECT NEXT TIME THE GAME LOADS.",
        1 => "SPINNING CHEST REELS, BAR FILLS AND SCREEN EFFECTS. AUTO FOLLOWS YOUR DEVICE'S " +
             "REDUCE-MOTION SETTING, WHICH SOME SYSTEMS TURN ON FOR REASONS UNRELATED TO GAMES.",
        _ => "FRAME TIME, ENTITY COUNTS AND DROPPED EVENTS, OVER THE HUD.",
    };

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

    /// <summary>A panel card: a fill inside a hairline outline, both rounded.</summary>
    /// <remarks>
    /// <para>
    /// THE BORDER IS DRAWN AS THE LAYER UNDER THE FILL, which is what `box-sizing: border-box`
    /// amounts to and is the only way to get a rounded outline out of a rounded rectangle without a
    /// stencil. The fill is inset by the border width and its radius shrinks with it, or the corners
    /// bulge through.
    /// </para>
    /// <para>
    /// EVERY LIST ROW ON EVERY MENU IS ONE OF THESE. The port drew bare text on the ground - which
    /// is legible, and is not what the game looks like. A settings row, a workshop row, a level and
    /// a chassis are all the same object in the original: `background: var(--panel)`, a
    /// `var(--line)` hairline, sixteen pixels of radius.
    /// </para>
    /// </remarks>
    private static void Card(SpriteBatch batch, Sprites sprites, Rectangle r, int radius,
                             Color fill, Color line, int thick)
    {
        RoundRect(batch, sprites, r, radius, line);
        RoundRect(batch, sprites,
                  new Rectangle(r.X + thick, r.Y + thick, r.Width - thick * 2, r.Height - thick * 2),
                  radius - thick, fill);
    }

    /// <summary>Mark the row the cursor is on.</summary>
    /// <remarks>
    /// A RING, NOT A REPAINT. The web build has no cursor - it is a touch screen, and the thing you
    /// are about to press is the thing under your thumb. A pad needs somewhere to be, and the
    /// cheapest way to say so without inventing a second appearance for every row is to put the
    /// accent round the outside of the one it is on.
    /// </remarks>
    private static void Cursor(SpriteBatch batch, Sprites sprites, Rectangle r, int radius,
                               int thick)
    {
        RoundRect(batch, sprites,
                  new Rectangle(r.X - thick, r.Y - thick, r.Width + thick * 2, r.Height + thick * 2),
                  radius + thick, Palette.Accent);
    }

    /// <summary>A screen's heading: a faint eyebrow over a heavy title.</summary>
    /// <returns>The y the content below it starts at.</returns>
    /// <remarks>
    /// THE EYEBROW SAYS WHAT KIND OF PLACE THIS IS and the title says which one. Two words where
    /// one would do, and it is worth it on a screen a player arrives at from a menu: "OPTIONS /
    /// SETTINGS" tells you instantly that you have not left the shell for the game.
    /// </remarks>
    private static int Head(SpriteBatch batch, Sprites sprites, string eyebrow, string title,
                            int vw, int y, int scale)
    {
        int small = System.Math.Max(1, scale - 1);
        Font.DrawCentred(batch, sprites.Blank, Spaced(eyebrow), vw / 2, y, small, Palette.Faint);
        y += Font.LineHeight * small + 3 * scale;
        Font.DrawCentred(batch, sprites.Blank, title, vw / 2, y, scale * 2, Palette.Ink);
        return y + Font.GlyphH * scale * 2 + 8 * scale;
    }

    /// <summary>Put a space between every letter.</summary>
    /// <remarks>
    /// THE BITMAP FONT HAS ONE TRACKING VALUE, so the wide `letter-spacing: 0.18em` an eyebrow is
    /// set in cannot be asked for - it has to be spelled. At this size a space IS 0.18em to within
    /// a pixel, which is why it looks right rather than merely different.
    /// </remarks>
    private static string Spaced(string text)
    {
        var sb = new System.Text.StringBuilder(text.Length * 2);
        foreach (char c in text)
        {
            if (sb.Length > 0) sb.Append(' ');
            sb.Append(c);
        }
        return sb.ToString();
    }

    /// <summary>The two-state pill an on/off setting is worked with.</summary>
    /// <remarks>
    /// 52x32 WITH A 26-WIDE KNOB, from `.switch`. The knob is faint ink when off and the accent's
    /// own near-black when on, so the control says which it is by COLOUR as well as by position -
    /// a switch read at a glance is read by where the bright part is.
    /// </remarks>
    private static void Pill(SpriteBatch batch, Sprites sprites, Rectangle r, bool on)
    {
        Card(batch, sprites, r, r.Height / 2, on ? Palette.Accent : Palette.Sunken,
             on ? Palette.Accent : Palette.Edge, System.Math.Max(1, r.Height / 16));

        int knob = r.Height - 4;
        int kx = on ? r.Right - knob - 2 : r.X + 2;
        RoundRect(batch, sprites, new Rectangle(kx, r.Y + 2, knob, knob), knob / 2,
                  on ? Palette.OnAccent : Palette.Faint);
    }

    /// <summary>A row of mutually exclusive options, one of them lit.</summary>
    /// <remarks>
    /// THREE CHOICES RATHER THAN A SWITCH for Animations, and the reason is in `settingsScreen.ts`:
    /// on Windows the device's reduce-motion answer comes from a setting about window minimise
    /// animations and means nothing about this game, so "Auto" has to be a third option a player can
    /// decline rather than the only behaviour.
    /// </remarks>
    private static void Segmented(SpriteBatch batch, Sprites sprites, Rectangle r,
                                  string[] options, int chosen, int scale)
    {
        Card(batch, sprites, r, 6 * scale, Palette.Sunken, Palette.Edge, System.Math.Max(1, scale / 2));

        int seg = r.Width / options.Length;
        for (int i = 0; i < options.Length; i++)
        {
            var cell = new Rectangle(r.X + i * seg, r.Y, seg, r.Height);
            if (i == chosen)
            {
                RoundRect(batch, sprites, cell, i == 0 || i == options.Length - 1 ? 6 * scale : 0,
                          Palette.Accent);
            }
            else if (i > 0)
            {
                // The hairline between two unlit segments, which `box-shadow: inset 1px 0 0` puts
                // there. It is what stops three words reading as one.
                batch.Draw(sprites.Blank,
                           new Rectangle(cell.X, cell.Y + 2, System.Math.Max(1, scale / 2),
                                         cell.Height - 4), Palette.Edge);
            }

            Font.DrawCentred(batch, sprites.Blank, options[i], cell.Center.X,
                             cell.Y + (cell.Height - Font.GlyphH * scale) / 2, scale,
                             i == chosen ? Palette.OnAccent : Palette.Dim);
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
