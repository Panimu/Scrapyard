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
    /// <summary>What the debug readout shows. Gathered by the caller, which is the only thing that
    /// knows most of it.</summary>
    public readonly record struct DebugInfo(
        double FrameMs, double WorstMs, int Steps, int Enemies, int Projectiles, int Pickups,
        int Effects, int DroppedEvents);

    /// <summary>
    /// Frame time, entity counts and dropped events, over the HUD.
    /// </summary>
    /// <remarks>
    /// <para>
    /// THE WORST FRAME IS THE NUMBER THAT MATTERS, not the mean. A mean of 16 ms with one 90 ms
    /// spike a second is a game that stutters visibly and a readout that says it is fine; the two
    /// are shown together so the gap between them is legible at a glance.
    /// </para>
    /// <para>
    /// DROPPED EVENTS SHOULD STAY AT ZERO. The event ring is fixed-size and the renderer drains it
    /// once a frame - anything else means effects were overwritten before they were drawn, which is
    /// silent everywhere except here.
    /// </para>
    /// <para>
    /// AND THE STEP COUNT IS HOW THE SIMULATION IS COPING. More than one means the frame was long
    /// enough that the fixed step had to catch up, which is the difference between "the renderer is
    /// slow" and "everything is slow".
    /// </para>
    /// </remarks>
    public static void DrawDebug(SpriteBatch batch, Sprites sprites, World w, DebugInfo d,
                                 int vw, int vh)
    {
        int scale = System.Math.Max(1, vh / 480);
        string[] lines =
        {
            $"{d.FrameMs:0.0} MS  WORST {d.WorstMs:0.0}  X{d.Steps}",
            $"ENEMY {d.Enemies}  SHELL {d.Projectiles}  GEM {d.Pickups}",
            $"FX {d.Effects}  DROP {d.DroppedEvents}",
            $"BEAM {w.Beams.Count}  WEAPONS {w.WeaponCount}",
            $"TICK {w.Tick}  RUN {w.RunSec:0.0}S  PHASE {w.Phase}",
        };

        int wide = 0;
        foreach (string l in lines) wide = System.Math.Max(wide, Font.Measure(l, scale));

        int pad = 4 * scale;
        int x = 8;
        int y = vh - lines.Length * Font.LineHeight * scale - pad * 2 - 8;
        batch.Draw(sprites.Blank,
                   new Rectangle(x, y, wide + pad * 2, lines.Length * Font.LineHeight * scale + pad * 2),
                   new Color(0, 0, 0, 170));

        // A DROPPED EVENT IS THE ONE LINE WORTH COLOURING. Everything else here is a number you
        // read; that one is a number you act on.
        for (int i = 0; i < lines.Length; i++)
        {
            var tint = i == 2 && d.DroppedEvents > 0 ? new Color(0xff, 0x6a, 0x5a) : Ink;
            Font.Draw(batch, sprites.Blank, lines[i], x + pad,
                      y + pad + i * Font.LineHeight * scale, scale, tint);
        }
    }

    /// <summary>
    /// The Cyber Chest - three reels, a payout, and the upgrades it just handed you.
    /// </summary>
    /// <remarks>
    /// <para>
    /// THIS OVERLAY DECIDES NOTHING. The simulation rolled the whole spin on the tick the player
    /// walked onto the chest: where each reel lands, what that pays, and exactly which upgrades are
    /// coming. Everything here is animation arriving at an answer it was given - which is the only
    /// way a chest can exist in this game at all, because a run is a seed and a list of inputs, and
    /// an outcome invented inside an animation could never be replayed.
    /// </para>
    /// <para>
    /// THE DECOYS COME FROM THE SAME POOL THE SIMULATION ROLLED FROM, and that is not cosmetic. A
    /// machine that blurs past eight guns you have never carried and then lands on your Long Laser
    /// is a machine that was never really spinning; the player has to believe any symbol going past
    /// COULD have stopped there.
    /// </para>
    /// <para>
    /// REDUCED MOTION COLLAPSES THE WHOLE THING TO THE RESULT - no spin, no landings, no
    /// anticipation. Someone who has asked for less movement has not asked for a two-second spin,
    /// and certainly has not asked for the machine to shake. See <c>Settings.ReducesMotion</c>: the
    /// answer comes from the player's own three-state preference rather than from the system,
    /// because on Windows the system's answer is about window minimise animations.
    /// </para>
    /// </remarks>
    public static void DrawChest(SpriteBatch batch, Sprites sprites, World w, double elapsedMs,
                                 bool reduced, int vw, int vh)
    {
        Scrim(batch, sprites, vw, vh);
        var chest = w.Chest;
        int scale = System.Math.Max(1, vh / 400);

        Span<int> heat = stackalloc int[3];
        ChestSpin.PlanHeat(chest.Reels, chest.Payout, chest.Ascension, heat);
        Span<double> landAt = stackalloc double[3];
        ChestSpin.LandAt(heat[1], landAt);

        // A REDUCED SPIN IS NOT A FAST SPIN. Every reel is simply at its answer, which is what
        // "collapses to the result" has to mean - a very quick spin still moves.
        double t = reduced ? double.PositiveInfinity : elapsedMs;

        Font.DrawCentred(batch, sprites.Blank, "CYBER CHEST", vw / 2, (int)(vh * 0.16), scale * 2,
                         Accent);

        int box = 56 * scale;
        int gap = 10 * scale;
        int n = chest.Reels.Length;
        int x0 = (vw - (box * n + gap * (n - 1))) / 2;
        int y0 = (int)(vh * 0.30);

        bool allLanded = true;
        for (int i = 0; i < n; i++)
        {
            int x = x0 + i * (box + gap);
            double prog = ChestSpin.ReelProgress(i, t, landAt[i], heat[1] > ChestSpin.HeatNone);
            bool landed = prog >= 1;
            if (!landed) allLanded = false;

            // THE WINDOW BRIGHTENS ON THE LANDING IT EARNED, and only reel three's is sized by an
            // actual payout - see ChestSpin.PlanHeat for why reel two says nothing unless it is
            // matching, and reel one never says anything at all.
            Frame(batch, sprites, x, y0, box, box);
            if (landed && heat[i] > ChestSpin.HeatNone)
            {
                var glow = heat[i] == ChestSpin.HeatBlaze ? Accent : new Color(0xff, 0xa0, 0x4f);
                batch.Draw(sprites.Blank, new Rectangle(x - 2, y0 - 2, box + 4, box + 4),
                           glow * 0.35f);
            }

            DrawReel(batch, sprites, w, i, prog, x, y0, box, scale);
        }

        int ty = y0 + box + 14 * scale;

        // THE HEADLINE LANDS WITH THE LAST REEL, not after it: the word arrives on the same frame
        // as the symbol that earned it, which is the moment the player is already looking at. It is
        // the GRANTS list that waits out the beat, so the pause is spent on the detail.
        if (!allLanded)
        {
            Font.DrawCentred(batch, sprites.Blank, "[1] SKIP", vw / 2, ty + 10 * scale, scale, Dim);
            return;
        }

        if (chest.Ascension >= 0)
        {
            // AN ASCENSION IS THE ONE THING IN THIS GAME MEANT TO BE FOUND, so it is announced
            // rather than folded into the payout line.
            Font.DrawCentred(batch, sprites.Blank, "ASCENSION", vw / 2, ty, scale * 2, Accent);
            ty += 20 * scale;
            Font.DrawCentred(batch, sprites.Blank,
                             CardTexts.At(chest.Ascension).Name.ToUpperInvariant(), vw / 2, ty,
                             scale, Ink);
            ty += 14 * scale;
        }
        else
        {
            string word = chest.Payout >= 0 && chest.Payout < ChestSpin.PayoutName.Length
                ? ChestSpin.PayoutName[chest.Payout]
                : "";
            if (word != "")
            {
                Font.DrawCentred(batch, sprites.Blank, word, vw / 2, ty, scale * 2, Accent);
                ty += 20 * scale;
            }
            Font.DrawCentred(batch, sprites.Blank, $"{chest.Payout} UPGRADES", vw / 2, ty, scale,
                             Ink);
            ty += 14 * scale;
        }

        if (ChestSpin.GrantsShown(t, landAt[2]))
        {
            for (int i = 0; i < chest.Payout && i < chest.Grants.Length; i++)
            {
                int g = chest.Grants[i];
                if (g < 0) continue;
                Font.DrawCentred(batch, sprites.Blank, CardTexts.At(g).Name.ToUpperInvariant(),
                                 vw / 2, ty, scale, Dim);
                ty += Font.LineHeight * scale;
            }
        }

        Font.DrawCentred(batch, sprites.Blank, "[1] TAKE IT", vw / 2, ty + 10 * scale, scale, Accent);
    }

    /// <summary>
    /// One reel: a strip of icons scrolling up to the one the simulation chose.
    /// </summary>
    /// <remarks>
    /// <para>
    /// THE LAST TILE IS THE ANSWER and everything above it is decoration that exists to be blurred
    /// past. The strip is drawn clipped to the window, so what is on screen is the tile the
    /// progress lands on plus whatever is arriving behind it.
    /// </para>
    /// <para>
    /// THE DECOYS ARE THE PLAYER'S OWN CARDS, walked deterministically from the reel's own index
    /// rather than rolled - the renderer has no business drawing from any random stream, and a
    /// stable strip means a reel that is redrawn mid-spin does not reshuffle underneath itself.
    /// </para>
    /// </remarks>
    private static void DrawReel(SpriteBatch batch, Sprites sprites, World w, int r, double prog,
                                 int x, int y, int box, int scale)
    {
        var chest = w.Chest;
        int landed = chest.Reels[r];
        if (landed < 0) return;

        int tiles = ChestSpin.StripTiles(r);
        int pad = 6 * scale;
        int inner = box - pad * 2;

        // How far up the strip we are, in tiles. At 1 the last tile - the answer - is in the window.
        double at = prog * tiles;
        int top = (int)System.Math.Floor(at);
        double frac = at - top;

        for (int k = 0; k <= 1; k++)
        {
            int index = top + k;
            int card = index >= tiles ? landed : DecoyAt(w, r, index);
            if (card < 0) continue;

            var tex = sprites.Get(CardTexts.At(card).IconKey);
            if (tex is null) continue;

            // The tile slides up through the window; the one behind it comes in from below.
            int oy = (int)((k - frac) * inner);
            var dst = new Rectangle(x + pad, y + pad + oy, inner, inner);

            // CLIPPED BY HAND rather than with a scissor rectangle: a scissor test is a device state
            // change and this is inside one batch with everything else on screen.
            if (dst.Bottom <= y + pad || dst.Y >= y + box - pad) continue;
            batch.Draw(tex, dst, Color.White);
        }
    }

    /// <summary>
    /// A symbol to blur past, from the player's own loadout.
    /// </summary>
    /// <remarks>
    /// DETERMINISTIC AND NOT FROM ANY RNG STREAM. The renderer must not touch the simulation's
    /// randomness - drawing a frame twice would then change the run - and a strip walked from the
    /// index is stable, so a reel redrawn mid-spin shows the same decoys it did last frame.
    /// </remarks>
    private static int DecoyAt(World w, int r, int index)
    {
        int n = CardTexts.All.Length;
        if (n <= 0) return -1;
        // Stepping by a number coprime with the catalog walks the whole of it without repeating,
        // which is what stops a strip showing the same three icons over and over.
        return (int)(((long)index * 7 + r * 3 + 1) % n);
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
