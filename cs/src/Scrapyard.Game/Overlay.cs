using Microsoft.Xna.Framework;
using Microsoft.Xna.Framework.Graphics;

using Scrapyard.Core;

namespace Scrapyard.Game;

/// <summary>
/// The HUD and the two overlays that stop the world: the level-up card and the Cyber Chest.
/// </summary>
/// <remarks>
/// <para>
/// A CARD FREEZES EVERYTHING, which is why this is not decoration. <c>StepWorld</c> takes one
/// branch while the phase is <see cref="RunPhase.LevelUp"/> or <see cref="RunPhase.Chest"/>: only
/// progression runs, and it consumes <c>Input.ChooseIndex</c>. Until something sends a choice the
/// run is stopped dead - so a front-end without this screen is a front-end that is playable up to
/// level two.
/// </para>
/// <para>
/// THE OFFER SLOTS CAN BE NEGATIVE. <see cref="Constants.OfferHeal"/> and
/// <see cref="Constants.OfferCredits"/> are the consolation pair, dealt only once every upgrade in
/// the game has been taken - they are REAL offers with no catalog entry behind them, and a reader
/// that treats "negative" as "empty" shows a blank card at the one moment the player has earned
/// something. -1 is the empty slot; those two are not.
/// </para>
/// </remarks>
public static class Overlay
{
    private static readonly Color Ink = new(0xf2, 0xec, 0xdf);
    private static readonly Color Dim = new(0x9a, 0x92, 0x84);
    private static readonly Color Panel = new(0x1a, 0x16, 0x12);
    private static readonly Color Edge = new(0x53, 0x48, 0x3a);
    private static readonly Color Accent = new(0xff, 0xd3, 0x4f);

    /// <summary>The always-on readout: hull, shield, XP, level, clock, and what is in your hands.</summary>
    public static void DrawHud(SpriteBatch batch, Sprites sprites, World w, int vw, int vh)
    {
        var p = w.Player;
        int scale = System.Math.Max(1, vh / 360);

        // Hull. The number is on the bar rather than beside it: at a glance the bar is the answer,
        // and the number is for the moment you want to know exactly how much trouble you are in.
        double hpFrac = p.Stats.MaxHp > 0 ? System.Math.Clamp(p.Hp / p.Stats.MaxHp, 0, 1) : 0;
        int barW = vw - 24;
        Bar(batch, sprites, 12, 12, barW, 8 * scale, hpFrac,
            new Color(0x28, 0x10, 0x10), new Color(0xd6, 0x3c, 0x3c));
        Font.Draw(batch, sprites.Blank,
                  $"{System.Math.Ceiling(p.Hp):0} / {p.Stats.MaxHp:0}", 16, 14, scale, Ink);

        // The Energy Shield's rims, drawn as pips rather than folded into the hull bar: a rim is a
        // discrete thing that blocks one hit whatever its size, and a fraction would say otherwise.
        int y = 12 + 8 * scale + 3;
        for (int i = 0; i < p.ShieldLayers; i++)
        {
            batch.Draw(sprites.Blank, new Rectangle(12 + i * (7 * scale), y, 5 * scale, 4 * scale),
                       new Color(0x6f, 0xd8, 0xff));
        }
        if (p.ShieldLayers > 0) y += 4 * scale + 3;

        double xpFrac = p.XpToNext > 0 ? System.Math.Clamp(p.Xp / p.XpToNext, 0, 1) : 0;
        Bar(batch, sprites, 12, y, barW, 4 * scale, xpFrac,
            new Color(0x10, 0x18, 0x28), new Color(0x4f, 0xd1, 0xff));
        y += 4 * scale + 4;

        int mins = (int)(w.RunSec / 60);
        int secs = (int)(w.RunSec % 60);
        Font.Draw(batch, sprites.Blank, $"LV {p.Level}   {mins}:{secs:00}   x{w.Stats.Kills:0}",
                  12, y, scale, Dim);

        // WHAT IS IN YOUR HANDS, by icon, with the tier under each. The loadout is the run, and a
        // player who cannot see it cannot plan the next card.
        int ix = 12;
        int iy = vh - 12 - 20 * scale;
        for (int i = 0; i < w.WeaponCount; i++)
        {
            var inst = w.Weapons[i];
            int cardIndex = CardIndexForWeapon(w, inst.DefId);
            var tex = cardIndex >= 0 ? sprites.Get(CardTexts.At(cardIndex).IconKey) : null;
            int box = 20 * scale;
            if (tex is not null)
            {
                batch.Draw(tex, new Rectangle(ix, iy, box, box), Color.White);
            }
            Font.Draw(batch, sprites.Blank, $"{inst.Level}", ix + 1, iy + box + 1, scale, Dim);
            ix += box + 4;
        }
    }

    /// <summary>
    /// The catalog index of the card that grants a weapon def, or -1.
    /// </summary>
    /// <remarks>
    /// Searched rather than stored, because it is asked a handful of times a frame for a loadout of
    /// at most a dozen, and a second table mapping one to the other is a second thing to keep in
    /// step with the catalog.
    /// </remarks>
    private static int CardIndexForWeapon(World w, int defId)
    {
        if (defId < 0 || defId >= w.WeaponDefs.Length) return -1;
        int weaponId = w.WeaponDefs[defId].Id;
        for (int i = 0; i < w.UpgradeDefs.Length; i++)
        {
            if (w.UpgradeDefs[i].GrantsWeapon == weaponId) return i;
        }
        return -1;
    }

    // -----------------------------------------------------------------------------------------

    /// <summary>The level-up card: up to three offers, picked by number key.</summary>
    public static void DrawLevelUp(SpriteBatch batch, Sprites sprites, World w, int vw, int vh)
    {
        var lu = w.LevelUp;
        if (lu.OfferCount <= 0) return;

        Scrim(batch, sprites, vw, vh);
        int scale = System.Math.Max(1, vh / 400);

        Font.DrawCentred(batch, sprites.Blank, "LEVEL UP", vw / 2, (int)(vh * 0.10), scale * 2, Accent);
        string owed = lu.Pending > 1 ? $"{lu.Pending} PICKS OWED" : "CHOOSE ONE";
        Font.DrawCentred(batch, sprites.Blank, owed, vw / 2, (int)(vh * 0.10) + 22 * scale, scale, Dim);

        int n = lu.OfferCount;
        int gap = 12 * scale;
        int cardW = System.Math.Min((vw - gap * (n + 1)) / n, 150 * scale);
        int cardH = (int)(vh * 0.52);
        int totalW = cardW * n + gap * (n - 1);
        int x0 = (vw - totalW) / 2;
        int y0 = (int)(vh * 0.22);

        for (int i = 0; i < n; i++)
        {
            DrawCard(batch, sprites, w, lu.Offers[i], i, x0 + i * (cardW + gap), y0, cardW, cardH, scale);
        }

        // The reroll, and its count, because a reroll you have forgotten you own is a reroll you
        // will not spend.
        string reroll = w.InfiniteRerolls
            ? "[Q] REROLL"
            : lu.Rerolls > 0 ? $"[Q] REROLL  x{lu.Rerolls}" : "NO REROLLS LEFT";
        Font.DrawCentred(batch, sprites.Blank, reroll, vw / 2, y0 + cardH + 10 * scale, scale,
                         lu.Rerolls > 0 || w.InfiniteRerolls ? Ink : Dim);
    }

    private static void DrawCard(SpriteBatch batch, Sprites sprites, World w, int offer, int slot,
                                 int x, int y, int cw, int ch, int scale)
    {
        Frame(batch, sprites, x, y, cw, ch);

        string key = $"[{slot + 1}]";
        Font.Draw(batch, sprites.Blank, key, x + 6 * scale, y + 5 * scale, scale, Accent);

        string name;
        string desc;
        string? icon = null;
        string tier = "";

        if (offer == Constants.OfferHeal)
        {
            // THE CONSOLATION PAIR, dealt only when every upgrade in the game has been taken. It
            // exists so an emptied pool does not read as the game failing to hand out a level-up.
            name = "FIELD REPAIR";
            desc = "Patch the hull. There is nothing left to bolt on.";
        }
        else if (offer == Constants.OfferCredits)
        {
            name = "SALVAGE";
            desc = "A handful of credits. There is nothing left to bolt on.";
        }
        else if (offer >= 0)
        {
            var text = CardTexts.At(offer);
            name = text.Name;
            desc = text.Description;
            icon = text.IconKey;
            int held = offer < w.LevelUp.Stacks.Length ? w.LevelUp.Stacks[offer] : 0;
            // THE TIER YOU WOULD BE TAKING, not the one you hold. "TIER 3" on a card you own two of
            // is the honest label: it is what the pick buys.
            tier = held == 0 ? "NEW" : $"TIER {held + 1}";
        }
        else
        {
            return;
        }

        int cx = x + cw / 2;
        int iy = y + 20 * scale;
        int box = System.Math.Min(cw - 24 * scale, 48 * scale);
        if (icon is not null)
        {
            var tex = sprites.Get(icon);
            if (tex is not null)
            {
                batch.Draw(tex, new Rectangle(cx - box / 2, iy, box, box), Color.White);
            }
        }

        int ty = iy + box + 8 * scale;
        Font.DrawCentred(batch, sprites.Blank, tier, cx, ty, scale,
                         tier == "NEW" ? Accent : Dim);
        ty += 10 * scale;

        foreach (string line in Font.Wrap(name.ToUpperInvariant(), cw - 12 * scale, scale))
        {
            Font.DrawCentred(batch, sprites.Blank, line, cx, ty, scale, Ink);
            ty += Font.LineHeight * scale;
        }
        ty += 4 * scale;

        foreach (string line in Font.Wrap(desc, cw - 14 * scale, scale))
        {
            Font.DrawCentred(batch, sprites.Blank, line, cx, ty, scale, Dim);
            ty += Font.LineHeight * scale;
        }
    }

    // -----------------------------------------------------------------------------------------

    /// <summary>The Cyber Chest: three reels, a payout, and one key to close it.</summary>
    public static void DrawChest(SpriteBatch batch, Sprites sprites, World w, int vw, int vh)
    {
        Scrim(batch, sprites, vw, vh);
        var chest = w.Chest;
        int scale = System.Math.Max(1, vh / 400);

        Font.DrawCentred(batch, sprites.Blank, "CYBER CHEST", vw / 2, (int)(vh * 0.16), scale * 2,
                         Accent);

        int box = 56 * scale;
        int gap = 10 * scale;
        int n = chest.Reels.Length;
        int x0 = (vw - (box * n + gap * (n - 1))) / 2;
        int y0 = (int)(vh * 0.30);

        for (int i = 0; i < n; i++)
        {
            int x = x0 + i * (box + gap);
            Frame(batch, sprites, x, y0, box, box);
            int reel = chest.Reels[i];
            if (reel < 0) continue;
            var tex = sprites.Get(CardTexts.At(reel).IconKey);
            if (tex is not null)
            {
                int pad = 6 * scale;
                batch.Draw(tex, new Rectangle(x + pad, y0 + pad, box - pad * 2, box - pad * 2),
                           Color.White);
            }
        }

        int ty = y0 + box + 14 * scale;

        // AN ASCENSION IS THE ONE THING IN THIS GAME MEANT TO BE FOUND, so it is announced rather
        // than folded into the payout line.
        if (chest.Ascension >= 0)
        {
            Font.DrawCentred(batch, sprites.Blank, "ASCENSION", vw / 2, ty, scale * 2, Accent);
            ty += 20 * scale;
            Font.DrawCentred(batch, sprites.Blank,
                             CardTexts.At(chest.Ascension).Name.ToUpperInvariant(), vw / 2, ty,
                             scale, Ink);
            ty += 14 * scale;
        }
        else
        {
            Font.DrawCentred(batch, sprites.Blank, $"{chest.Payout} UPGRADES", vw / 2, ty, scale,
                             Ink);
            ty += 14 * scale;
        }

        for (int i = 0; i < chest.Payout && i < chest.Grants.Length; i++)
        {
            int g = chest.Grants[i];
            if (g < 0) continue;
            Font.DrawCentred(batch, sprites.Blank, CardTexts.At(g).Name.ToUpperInvariant(), vw / 2,
                             ty, scale, Dim);
            ty += Font.LineHeight * scale;
        }

        Font.DrawCentred(batch, sprites.Blank, "[1] TAKE IT", vw / 2, ty + 10 * scale, scale, Accent);
    }

    /// <summary>The end of the run, either way.</summary>
    public static void DrawEnd(SpriteBatch batch, Sprites sprites, World w, int vw, int vh)
    {
        Scrim(batch, sprites, vw, vh);
        int scale = System.Math.Max(1, vh / 400);
        bool won = w.Phase == RunPhase.Victory;

        Font.DrawCentred(batch, sprites.Blank, won ? "YARD CLEARED" : "WRECKED", vw / 2,
                         (int)(vh * 0.32), scale * 3,
                         won ? Accent : new Color(0xd6, 0x3c, 0x3c));

        int mins = (int)(w.RunSec / 60);
        int secs = (int)(w.RunSec % 60);
        int y = (int)(vh * 0.32) + 34 * scale;
        foreach (string line in new[]
        {
            $"SURVIVED   {mins}:{secs:00}",
            $"KILLS      {w.Stats.Kills:0}",
            $"LEVEL      {w.Player.Level}",
            $"DAMAGE     {w.Stats.DamageDealt:0}",
        })
        {
            Font.DrawCentred(batch, sprites.Blank, line, vw / 2, y, scale, Ink);
            y += Font.LineHeight * scale + 2;
        }

        Font.DrawCentred(batch, sprites.Blank, "[F5] NEW RUN", vw / 2, y + 12 * scale, scale, Dim);
    }

    // -----------------------------------------------------------------------------------------

    /// <summary>
    /// What the run has just earned, in the corner.
    /// </summary>
    /// <remarks>
    /// SHOWN WHILE THE RUN CONTINUES, because that is when it is earned - the banking happens on a
    /// clock rather than at the end, so the news arrives at the moment it becomes true. Telling the
    /// player on the summary screen instead would make an unlock feel like a reward for stopping.
    /// </remarks>
    public static void DrawToast(SpriteBatch batch, Sprites sprites, List<string> lines, int vw,
                                 int vh)
    {
        if (lines.Count == 0) return;
        int scale = System.Math.Max(1, vh / 400);
        int y = vh / 3;
        foreach (string line in lines)
        {
            Font.DrawCentred(batch, sprites.Blank, "UNLOCKED", vw / 2, y, scale, Dim);
            Font.DrawCentred(batch, sprites.Blank, line.ToUpperInvariant(), vw / 2,
                             y + Font.LineHeight * scale, scale * 2, Accent);
            y += Font.LineHeight * scale * 4;
        }
    }

    private static void Scrim(SpriteBatch batch, Sprites sprites, int vw, int vh) =>
        batch.Draw(sprites.Blank, new Rectangle(0, 0, vw, vh), new Color(0, 0, 0, 190));

    /// <summary>A panel with a one-pixel edge. Drawn from the blank texture; no nine-patch needed.</summary>
    private static void Frame(SpriteBatch batch, Sprites sprites, int x, int y, int w, int h)
    {
        batch.Draw(sprites.Blank, new Rectangle(x, y, w, h), Panel);
        batch.Draw(sprites.Blank, new Rectangle(x, y, w, 2), Edge);
        batch.Draw(sprites.Blank, new Rectangle(x, y + h - 2, w, 2), Edge);
        batch.Draw(sprites.Blank, new Rectangle(x, y, 2, h), Edge);
        batch.Draw(sprites.Blank, new Rectangle(x + w - 2, y, 2, h), Edge);
    }

    private static void Bar(SpriteBatch batch, Sprites sprites, int x, int y, int w, int h,
                            double frac, Color back, Color front)
    {
        batch.Draw(sprites.Blank, new Rectangle(x, y, w, h), back * 0.9f);
        int fill = (int)(w * frac);
        if (fill > 0) batch.Draw(sprites.Blank, new Rectangle(x, y, fill, h), front);
    }
}
