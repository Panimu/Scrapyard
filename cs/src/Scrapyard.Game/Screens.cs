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
    Trophies,
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
    private static readonly Color Ink = new(0xf2, 0xec, 0xdf);
    private static readonly Color Dim = new(0x9a, 0x92, 0x84);
    private static readonly Color Locked = new(0x4a, 0x43, 0x39);
    private static readonly Color Panel = new(0x1a, 0x16, 0x12);
    private static readonly Color Edge = new(0x53, 0x48, 0x3a);
    private static readonly Color Accent = new(0xff, 0xd3, 0x4f);
    private static readonly Color Good = new(0x6f, 0xe3, 0x6f);

    // -----------------------------------------------------------------------------------------

    public static void DrawTitle(SpriteBatch batch, Sprites sprites, Settings save, int vw, int vh)
    {
        Backdrop(batch, sprites, vw, vh);
        int scale = System.Math.Max(1, vh / 300);

        Font.DrawCentred(batch, sprites.Blank, "SCRAPYARD", vw / 2, (int)(vh * 0.22), scale * 3, Accent);
        Font.DrawCentred(batch, sprites.Blank, $"{save.Credits} CREDITS", vw / 2,
                         (int)(vh * 0.22) + 34 * scale, scale, Dim);

        int y = (int)(vh * 0.46);
        Menu(batch, sprites, vw, ref y, scale, new[]
        {
            ("[ENTER]", "NEW RUN", true),
            ("[C]", "CHASSIS", true),
            ("[Y]", "YARD", save.UnlockedLevels.Count > 1),
            ("[W]", "WORKSHOP", true),
            ("[T]", "TROPHIES", true),
            ("[ESC]", "QUIT", true),
        });

        var hero = HeroUnlocks.Heroes[System.Math.Clamp(save.LastHeroId, 0, HeroUnlocks.Heroes.Length - 1)];
        Font.DrawCentred(batch, sprites.Blank,
                         $"{hero.Name.ToUpperInvariant()}  /  {NameOfLevel(save.LastLevelId).ToUpperInvariant()}",
                         vw / 2, vh - 30 * scale, scale, Dim);
    }

    // -----------------------------------------------------------------------------------------

    /// <summary>
    /// The roster. Owned chassis show their sprite and name; locked ones show a silhouette.
    /// </summary>
    /// <remarks>
    /// A LOCKED CHASSIS IS A SILHOUETTE AND A QUESTION MARK, and no more than that. Stating the
    /// criteria here would turn the roster into a checklist and delete the one thing an unlock is
    /// for, which is being surprised by it.
    /// </remarks>
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

    /// <summary>Rows the trophy list shows at once. The rest scrolls.</summary>
    public const int TrophyRows = 9;

    /// <summary>
    /// The trophy case.
    /// </summary>
    /// <remarks>
    /// A SECRET SHOWS NOTHING BUT ITS SHAPE. Its icon is drawn as a silhouette, its name is question
    /// marks and its description is blank - because "Turned a Medium Laser into the Chain Laser" is
    /// a sentence that tells you a Chain Laser exists, that a Medium Laser becomes one, and that
    /// there is something to go looking for. That was taken out of the manual on purpose, and a
    /// trophy list is exactly the back door it would come back in through.
    ///
    /// AND THE DESCRIPTION IS IN THE PAST TENSE even when shown, because it is a record of what
    /// happened rather than an instruction. There is no imperative form of it anywhere in the port.
    /// </remarks>
    public static void DrawTrophies(SpriteBatch batch, Sprites sprites, Settings save, int cursor,
                                    int vw, int vh)
    {
        Backdrop(batch, sprites, vw, vh);
        int scale = System.Math.Max(1, vh / 400);

        var (got, total) = Meta.Achievements.Tally(save);
        Font.DrawCentred(batch, sprites.Blank, "TROPHIES", vw / 2, 10 * scale, scale * 2, Accent);
        Font.DrawCentred(batch, sprites.Blank, $"{got} OF {total}", vw / 2, 32 * scale, scale, Dim);

        var all = Meta.Achievements.All;
        int rowH = 26 * scale;
        int listW = System.Math.Min(vw - 40, 300 * scale);
        int x0 = (vw - listW) / 2;
        int top = 50 * scale;

        // The window follows the cursor rather than paging, so moving one row never jumps the view.
        int first = System.Math.Clamp(cursor - TrophyRows / 2, 0,
                                      System.Math.Max(0, all.Length - TrophyRows));

        for (int r = 0; r < TrophyRows && first + r < all.Length; r++)
        {
            int i = first + r;
            var a = all[i];
            bool earned = save.UnlockedAchievements.Contains(a.Id);
            var (name, desc) = Meta.Achievements.Display(a, earned);
            int y = top + r * rowH;

            if (i == cursor)
            {
                batch.Draw(sprites.Blank, new Rectangle(x0 - 4, y - 2, listW + 8, rowH - 2), Panel);
            }

            int box = 20 * scale;
            var tex = sprites.Get(a.Icon);
            if (tex is not null)
            {
                batch.Draw(tex, new Rectangle(x0, y, box, box),
                           earned ? Color.White : new Color(0, 0, 0, 190));
            }

            Font.Draw(batch, sprites.Blank, name.ToUpperInvariant(), x0 + box + 6 * scale, y, scale,
                      earned ? Ink : Locked);
            if (desc != "")
            {
                Font.Draw(batch, sprites.Blank, desc, x0 + box + 6 * scale,
                          y + Font.LineHeight * scale, scale, Dim);
            }
        }

        if (all.Length > TrophyRows)
        {
            Font.DrawCentred(batch, sprites.Blank, $"{cursor + 1} / {all.Length}", vw / 2,
                             top + TrophyRows * rowH + 4 * scale, scale, Dim);
        }

        Font.DrawCentred(batch, sprites.Blank, "[ARROWS] MOVE   [ESC] BACK", vw / 2,
                         vh - 16 * scale, scale, Dim);
    }

    // -----------------------------------------------------------------------------------------

    public static void DrawPause(SpriteBatch batch, Sprites sprites, World w, int vw, int vh)
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
        Menu(batch, sprites, vw, ref y, scale, new[]
        {
            ("[ESC]", "RESUME", true),
            ("[F5]", "NEW RUN", true),
            ("[BACKSPACE]", "ABANDON", true),
        });

        // ABANDONING IS SAFE, and saying so matters: the banking rule means everything earned is
        // already in the save. A player who does not know that will keep playing a run they are not
        // enjoying to protect progress they already have.
        Font.DrawCentred(batch, sprites.Blank, "EVERYTHING EARNED IS ALREADY BANKED", vw / 2,
                         vh - 24 * scale, scale, Dim);
    }

    // -----------------------------------------------------------------------------------------

    private static void Menu(SpriteBatch batch, Sprites sprites, int vw, ref int y, int scale,
                             (string Key, string Label, bool Enabled)[] items)
    {
        foreach (var (key, label, enabled) in items)
        {
            var colour = enabled ? Ink : Locked;
            int w = Font.Measure($"{key}  {label}", scale * 2);
            Font.Draw(batch, sprites.Blank, key, vw / 2 - w / 2, y, scale * 2,
                      enabled ? Accent : Locked);
            Font.Draw(batch, sprites.Blank, label,
                      vw / 2 - w / 2 + Font.Measure($"{key}  ", scale * 2), y, scale * 2, colour);
            y += 26 * scale;
        }
    }

    /// <summary>The menu ground: the floor tile, dimmed, so a menu is somewhere rather than nowhere.</summary>
    private static void Backdrop(SpriteBatch batch, Sprites sprites, int vw, int vh)
    {
        var tex = sprites.Get("floor");
        if (tex is not null)
        {
            for (int y = 0; y < vh; y += 128)
            {
                for (int x = 0; x < vw; x += 128)
                {
                    batch.Draw(tex, new Rectangle(x, y, 128, 128), Color.White);
                }
            }
        }
        batch.Draw(sprites.Blank, new Rectangle(0, 0, vw, vh), new Color(0, 0, 0, 205));
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
