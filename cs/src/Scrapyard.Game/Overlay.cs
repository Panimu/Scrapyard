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

    /// <summary>The always-on readout: hull, shield, XP, level, clock, and what is in your hands.</summary>
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
        int scale = Screens.MenuScale(vh);
        int small = Screens.SmallScale(vh);
        int width = Screens.Column(vw, scale);
        int x0 = (vw - width) / 2;

        // THREE CARDS DOWN THE SCREEN AND PINNED TO THE BOTTOM OF IT, not three columns across the
        // middle. The port had them side by side and stretched to half the window's height, which
        // gave every card a third of a phone's width to wrap two sentences in and left two thirds
        // of each card empty underneath. `justify-content: flex-end` on a column is where the cards
        // actually live: a full-width row is what a sentence wants, and the bottom of the screen is
        // where the thumb already is.
        int n = lu.OfferCount;
        int gap = 5 * scale;
        int radius = 7 * scale;

        var heights = new int[n];
        int stack = 0;
        for (int i = 0; i < n; i++)
        {
            heights[i] = CardHeight(w, lu.Offers[i], width, scale, small);
            stack += heights[i] + gap;
        }

        int rerollH = Font.GlyphH * scale + 12 * scale;
        int autoH = Font.LineHeight * small + 6 * scale;
        int bottom = vh - 12 * scale - autoH - rerollH - 4 * scale;
        int y = bottom - stack;

        Font.DrawCentred(batch, sprites.Blank, Screens.Spaced("LEVEL UP"), vw / 2,
                         y - 10 * scale - Font.GlyphH * scale * 2 - Font.LineHeight * small,
                         small, Faint);
        string owed = lu.Pending > 1 ? $"CHOOSE ONE ({lu.Pending} PENDING)" : "CHOOSE ONE";
        Font.DrawCentred(batch, sprites.Blank, owed, vw / 2,
                         y - 8 * scale - Font.GlyphH * scale * 2, scale * 2, Ink);

        for (int i = 0; i < n; i++)
        {
            DrawCard(batch, sprites, w, lu.Offers[i], i,
                     new Rectangle(x0, y, width, heights[i]), radius, scale, small);
            y += heights[i] + gap;
        }

        // REROLL SITS BELOW THE CARDS, not among them. It is not a fourth option - taking it does
        // not spend the level - and a thumb reaching for the bottom card must not find it by
        // accident.
        y += 2 * scale;
        bool canReroll = lu.Rerolls > 0 || w.InfiniteRerolls;
        string reroll = w.InfiniteRerolls ? "REROLL (INFINITE)"
                      : lu.Rerolls > 0 ? $"REROLL ({lu.Rerolls})" : "NO REROLLS LEFT";
        Screens.OverlayButton(batch, sprites, new Rectangle(x0, y, width, rerollH), reroll, "Q",
                              scale, canReroll);
        y += rerollH + 4 * scale;

        // AUTO-LEVEL, OFFERED WHERE IT IS WANTED. The pause menu has the switch, but the moment a
        // player decides they are tired of choosing is the moment a card is in front of them - and
        // making them pause, find a menu and come back is asking them to do the thing they just
        // said they did not want to do.
        //
        // BELOW THE REROLL, which is already below the cards: this is the least-reached control on
        // the screen and the one with the largest consequence, so it sits furthest from the thumb.
        Font.DrawCentred(batch, sprites.Blank, "[A] AUTO LEVEL FROM HERE", vw / 2, y, small, Faint);
    }

    /// <summary>What one offer says: its name, its tier line, and what the tier does.</summary>
    /// <remarks>
    /// READ ONCE AND MEASURED ONCE. The card's height depends on how its description wraps, and the
    /// height has to be known before the stack can be positioned - so both go through here rather
    /// than the wrapping being done twice and going out of step.
    /// </remarks>
    private static (string Name, string Tier, string Desc, string Stacks, bool Weapon, string? Icon)
        CardText(World w, int offer)
    {
        if (offer == Constants.OfferHeal)
        {
            // THE CONSOLATION PAIR, dealt only when every upgrade in the game has been taken. It
            // exists so an emptied pool does not read as the game failing to hand out a level-up.
            return ("FIELD REPAIR", "", "Patch the hull. There is nothing left to bolt on.",
                    "SALVAGE", false, null);
        }
        if (offer == Constants.OfferCredits)
        {
            return ("SALVAGE", "", "A handful of credits. There is nothing left to bolt on.",
                    "SALVAGE", false, null);
        }
        if (offer < 0) return ("", "", "", "", false, null);

        var text = CardTexts.At(offer);
        int held = offer < w.LevelUp.Stacks.Length ? w.LevelUp.Stacks[offer] : 0;
        int tier = held + 1;
        int max = offer < UpgradeCatalog.All.Length ? UpgradeCatalog.All[offer].MaxStacks : 1;
        bool unlock = held == 0;
        bool weapon = text.Weapon;

        // "NEW WEAPON" ONLY IF IT IS ONE. A passive announced as a weapon is the kind of small lie
        // that teaches a player the card text cannot be trusted.
        string tierLine = unlock
            ? $"NEW {(weapon ? "WEAPON" : "SYSTEM")} - TIER {tier} OF {max}"
            : $"TIER {tier} OF {max}";

        // WHAT THIS TIER DOES, straight from the catalog - the number on screen is the number. An
        // unlock shows the card's own description instead, because "Unlock." describes nothing.
        string desc = unlock ? text.Description : text.TierAt(tier);

        // THE TIER YOU WOULD BE TAKING, not the one you hold. "TIER 3" on a card you own two of is
        // the honest label: it is what the pick buys.
        return (text.Name, tierLine, desc, unlock ? "NEW" : $"TIER {tier}", weapon, text.IconKey);
    }

    private static int CardHeight(World w, int offer, int width, int scale, int small)
    {
        var t = CardText(w, offer);
        if (t.Name == "") return 0;

        int textW = width - 14 * scale - 22 * scale;
        int h = 7 * scale + Font.GlyphH * scale + 2 * scale;
        if (t.Tier != "") h += Font.LineHeight * small + 3 * scale;
        h += Font.Wrap(t.Desc, textW, small).Count * Font.LineHeight * small;
        h += 7 * scale;
        return System.Math.Max(h, 39 * scale);
    }

    private static void DrawCard(SpriteBatch batch, Sprites sprites, World w, int offer, int slot,
                                 Rectangle r, int radius, int scale, int small)
    {
        var t = CardText(w, offer);
        if (t.Name == "") return;

        // WHICH POOL, BEFORE A WORD IS READ. Gold is ordnance and blue is systems, and they are the
        // same two colours the chest reels and the manual's index already use - so the card is
        // saying something the player has learned rather than something they have to learn here.
        var key = t.Weapon ? Palette.Accent : Palette.Shop;
        bool unlock = t.Stacks == "NEW";

        // An unlock takes its pool's colour for a border. It is the louder card on purpose: a
        // weapon you do not have yet is a different kind of offer from a tier of one you do.
        Screens.CardFace(batch, sprites, r, radius, Palette.Panel, unlock ? key : Palette.Edge,
                         System.Math.Max(1, scale / 2));

        int pad = 7 * scale;
        int ix = r.X + pad;

        var tex = t.Icon is null ? null : sprites.Get(t.Icon);
        if (tex is not null)
        {
            int box = 16 * scale;
            batch.Draw(tex, new Rectangle(ix, r.Y + pad, box, box), Color.White);
            ix += box + 6 * scale;
        }

        // The key that takes it, on the left where the eye starts, rather than centred where the
        // name is. One glyph: a card is chosen by pressing a number.
        Font.Draw(batch, sprites.Blank, $"[{slot + 1}]", r.Right - pad - Font.Measure("[9]", small),
                  r.Y + pad, small, Faint);

        int ty = r.Y + pad;
        Font.Draw(batch, sprites.Blank, t.Name.ToUpperInvariant(), ix, ty, scale, Ink);
        ty += Font.GlyphH * scale + 2 * scale;

        if (t.Tier != "")
        {
            // DIMMED ON AN ORDINARY TIER so the unlock still reads as the louder card. One number
            // to move rather than a second pair of colours that can drift out of sync.
            Font.Draw(batch, sprites.Blank, Screens.Spaced(t.Tier), ix, ty, small,
                      unlock ? key : key * 0.72f);
            ty += Font.LineHeight * small + 3 * scale;
        }

        int textW = r.Width - (ix - r.X) - pad - 22 * scale;
        foreach (string line in Font.Wrap(t.Desc, textW, small))
        {
            Font.Draw(batch, sprites.Blank, line, ix, ty, small, Dim);
            ty += Font.LineHeight * small;
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


    /// <summary>How long an auto-pick's name floats over the mech.</summary>
    public const double PickRiseSec = 1.5;

    /// <summary>
    /// THE AUTO-LEVEL PICK, floated over the mech.
    /// </summary>
    /// <remarks>
    /// <para>
    /// When the game is choosing cards, the level-up screen never appears - which is the point of
    /// the feature and also its one problem: without this the player has NO idea what they just
    /// got. A run that quietly grows stronger is a run the player is no longer playing.
    /// </para>
    /// <para>
    /// ONLY WHEN THE GAME CHOSE. A card the player picked themselves was on screen a moment ago
    /// with its name on it, and repeating it over the mech would be noise.
    /// </para>
    /// <para>
    /// AND IT RISES AND FADES rather than sitting somewhere. It has to be readable without being
    /// something to look at: the fight did not stop for this.
    /// </para>
    /// </remarks>
    public static void DrawPickToast(SpriteBatch batch, Sprites sprites, string name, double left,
                                     int px, int py, int vh)
    {
        if (left <= 0 || name.Length == 0) return;
        int scale = System.Math.Max(1, vh / 400);

        double t = 1 - left / PickRiseSec;
        // Fades over the last third, so it is at full strength while it is worth reading.
        float alpha = (float)(t > 0.66 ? (1 - t) / 0.34 : 1);
        int y = py - (int)(t * 34 * scale) - 20 * scale;

        Font.DrawCentred(batch, sprites.Blank, name.ToUpperInvariant(), px, y, scale,
                         Accent * alpha);
    }

    /// <summary>
    /// Seconds the world holds still when Mech Insurance pays out, and therefore how long the
    /// banner is up.
    /// </summary>
    /// <remarks>
    /// 4.2 s, up from 1.2. The old figure was sized to READING the banner, which is the wrong thing
    /// to size it to: the player has just watched themselves die and is still holding a direction.
    /// The pause is for the moment to land, not for the words to be finished.
    /// </remarks>
    public const double SavePauseSec = 4.2;

    /// <summary>
    /// THE INSURANCE BANNER - the one moment the game stops to tell you something happened.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>A FULL STOP AND NOT A TOAST.</b> Mech Insurance fires ONCE PER RUN, at the exact instant
    /// the run would otherwise have ended, in the middle of whatever crowd just killed you.
    /// Everything about that moment works against noticing it: the player is already reacting to
    /// dying, the screen is at its busiest, and the mechanic's own evidence - a full health bar -
    /// looks identical to never having been in trouble.
    /// </para>
    /// <para>
    /// So the simulation freezes, the viewport shakes, and this says in words what just happened. A
    /// toast in the corner - the shape the achievements use - would be the wrong instrument twice
    /// over: it is for things that can be read later, and it does not stop the thing that is about
    /// to kill them again.
    /// </para>
    /// <para>
    /// <b>IT IS INERT.</b> No prompt, no key, nothing to acknowledge. It happens TO the player and
    /// then it is gone, and it must not eat the input they are almost certainly making.
    /// </para>
    /// </remarks>
    public static void DrawSaved(SpriteBatch batch, Sprites sprites, double left, int vw, int vh)
    {
        if (left <= 0) return;
        int scale = System.Math.Max(1, vh / 400);

        // THE FLASH IS ONLY AT THE START. A scrim that lasted the whole freeze would read as a
        // menu, and this is the opposite of a menu: the battlefield has to stay visible, because
        // what the player needs to understand is that it is still there and they are still in it.
        double t = 1 - left / SavePauseSec;
        double flash = t < 0.12 ? 1 - t / 0.12 : 0;
        if (flash > 0)
        {
            batch.Draw(sprites.Blank, new Rectangle(0, 0, vw, vh),
                       new Color(0xff, 0xd2, 0x57) * (float)(flash * 0.5));
        }

        int y = (int)(vh * 0.34);
        var band = new Rectangle(0, y - 6 * scale, vw, 46 * scale);
        batch.Draw(sprites.Blank, band, new Color(0, 0, 0, 190));

        Font.DrawCentred(batch, sprites.Blank, "MECH INSURANCE", vw / 2, y, scale, Dim);
        Font.DrawCentred(batch, sprites.Blank, "HULL RESTORED", vw / 2, y + 12 * scale, scale * 2,
                         Accent);
        Font.DrawCentred(batch, sprites.Blank, "SPENT - YOU ARE UNTOUCHABLE FOR A MOMENT", vw / 2,
                         y + 34 * scale, scale, Ink);
    }

    /// <summary>The end of the run, either way.</summary>
    /// <summary>
    /// What the run came to.
    /// </summary>
    /// <remarks>
    /// <para>
    /// THE SCREEN IS THE REWARD FOR A RUN THAT ENDED BADLY, which is most of them. A death that
    /// prints four numbers is a death; a death that shows what the guns actually did, what killed
    /// the most, and how close the horde got, is a run you want to think about. The web build gives
    /// this a whole scrolling body for that reason, and the port had it as a four-line epitaph.
    /// </para>
    /// <para>
    /// SURVIVED AND SCRAPPED, and the difference is a colour as well as a word - green for a win,
    /// hull red for a loss, because both of those already mean that everywhere else on screen.
    /// </para>
    /// </remarks>
    public static void DrawEnd(SpriteBatch batch, Sprites sprites, World w, int vw, int vh)
    {
        Scrim(batch, sprites, vw, vh);
        int scale = Screens.MenuScale(vh);
        int small = Screens.SmallScale(vh);
        int width = Screens.Column(vw, scale);
        int x0 = (vw - width) / 2;
        bool won = w.Phase == RunPhase.Victory;

        int y = 12 * scale;
        Font.DrawCentred(batch, sprites.Blank,
                         Screens.Spaced(won ? "SCRAPLORD DOWN" : "RUN OVER"), vw / 2, y, small,
                         Faint);
        y += Font.LineHeight * small + 3 * scale;
        Font.DrawCentred(batch, sprites.Blank, won ? "SURVIVED" : "SCRAPPED", vw / 2, y, scale * 2,
                         won ? Good : Palette.Hp);
        y += Font.GlyphH * scale * 2 + 10 * scale;

        int btnH = 27 * scale;
        int backY = vh - 12 * scale - btnH;
        Screens.OverlayButton(batch, sprites, new Rectangle(x0, backY, width, btnH), "NEW RUN",
                              "F5", scale, true);
        int bottom = backY - 8 * scale;

        // --- the numbers, two across ------------------------------------------------------------
        var stats = new List<(string K, string V)>
        {
            ("SURVIVED", $"{(int)(w.RunSec / 60)}:{(int)(w.RunSec % 60):00}"),
            ("LEVEL", w.Player.Level.ToString()),
            ("KILLS", $"{w.Stats.Kills:0}"),
            ("PEAK HORDE", $"{w.Stats.PeakEnemies:0}"),
            ("DAMAGE DEALT", Compact(w.Stats.DamageDealt)),
            ("DAMAGE TAKEN", Compact(w.Stats.DamageTaken)),
            ("ACCURACY", w.Stats.ShotsFired > 0
                         ? $"{(int)System.Math.Round(w.Stats.ShotsHit / w.Stats.ShotsFired * 100)}%"
                         : "-"),
            ("GEMS", $"{w.Stats.GemsCollected:0}"),
        };
        if (w.Stats.DamagePrevented > 0) stats.Add(("SHIELDED", Compact(w.Stats.DamagePrevented)));
        if (w.Stats.Credits > 0) stats.Add(("CREDITS", $"+{w.Stats.Credits:0}"));

        int gap = 4 * scale;
        int cellW = (width - gap) / 2;
        int cellH = 6 * scale + Font.LineHeight * small + Font.GlyphH * scale + 8 * scale;
        int thick = System.Math.Max(1, scale / 2);

        for (int i = 0; i < stats.Count; i++)
        {
            int cy = y + i / 2 * (cellH + gap);
            if (cy + cellH > bottom) break;
            var r = new Rectangle(x0 + i % 2 * (cellW + gap), cy, cellW, cellH);
            Screens.CardFace(batch, sprites, r, 6 * scale, Panel, Edge, thick);

            Font.Draw(batch, sprites.Blank, Screens.Spaced(stats[i].K), r.X + 6 * scale,
                      r.Y + 6 * scale, small, Faint);
            Font.Draw(batch, sprites.Blank, stats[i].V, r.X + 6 * scale,
                      r.Y + 6 * scale + Font.LineHeight * small, scale, Ink);
        }
        y += (stats.Count + 1) / 2 * (cellH + gap) + 4 * scale;

        // --- what did the damage ----------------------------------------------------------------
        //
        // SORTED, AND ONLY WHAT FIRED. A list of every weapon in the game with zeroes beside the
        // ones never held says nothing; the four guns that were carried, biggest first, is the
        // question a player asks after a run - "which of these was actually doing the work".
        var sources = new List<(string Name, double Amount)>();
        for (int i = 0; i < w.Stats.DamageByWeapon.Length && i < w.WeaponDefs.Length; i++)
        {
            if (w.Stats.DamageByWeapon[i] > 0)
            {
                sources.Add((WeaponName(w, i).ToUpperInvariant(), w.Stats.DamageByWeapon[i]));
            }
        }
        if (w.Stats.DamageByShield > 0) sources.Add(("ENERGY SHIELD", w.Stats.DamageByShield));
        sources.Sort((a, b) => b.Amount.CompareTo(a.Amount));

        double total = 0;
        foreach (var src in sources) total += src.Amount;

        var rows = new List<(string, string)>();
        foreach (var src in sources)
        {
            int pct = total > 0 ? (int)System.Math.Round(src.Amount / total * 100) : 0;
            rows.Add((src.Name, $"{Compact(src.Amount)}  {pct}%"));
        }
        if (rows.Count == 0) rows.Add(("NONE DEALT", ""));

        int listH = 6 * scale + Font.LineHeight * small
                  + (Font.LineHeight * small + scale) * rows.Count + 8 * scale;
        if (y + listH <= bottom)
        {
            var r = new Rectangle(x0, y, width, listH);
            Screens.CardFace(batch, sprites, r, 6 * scale, Panel, Edge, thick);

            int ly = r.Y + 6 * scale;
            Font.Draw(batch, sprites.Blank, Screens.Spaced("DAMAGE BY SOURCE"), r.X + 6 * scale, ly,
                      small, Faint);
            ly += Font.LineHeight * small + 2 * scale;

            foreach (var (k, v) in rows)
            {
                Font.Draw(batch, sprites.Blank, k, r.X + 6 * scale, ly, small, Dim);
                Font.Draw(batch, sprites.Blank, v,
                          r.Right - 6 * scale - Font.Measure(v, small), ly, small, Ink);
                ly += Font.LineHeight * small + scale;
            }
        }
    }

    /// <summary>A weapon's own name, for the summary's damage table.</summary>
    private static string WeaponName(World w, int defId)
    {
        int card = CardIndexForWeapon(w, defId);
        return card >= 0 ? CardTexts.At(card).Name : $"WEAPON {defId}";
    }

    /// <summary>Four thousand four hundred and twenty-seven as "4.4K".</summary>
    /// <remarks>
    /// THE EXACT FIGURE IS NOT THE POINT on this screen. Damage dealt is read to compare two guns
    /// against each other, and eight digits in a column defeat that faster than a rounded number
    /// ever could.
    /// </remarks>
    private static string Compact(double v)
    {
        if (v >= 1_000_000) return $"{v / 1_000_000:0.0}M";
        if (v >= 10_000) return $"{v / 1000:0}K";
        if (v >= 1000) return $"{v / 1000:0.0}K";
        return $"{v:0}";
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

    /// <summary>The dimming an overlay lays over the fight.</summary>
    /// <remarks>
    /// THE SAME SCRIM THE MENUS USE - rgba(6, 9, 13, 0.86) - because it IS the same scrim: one
    /// `.overlay` rule in the stylesheet covers the pause screen, the level-up, the chest and the
    /// summary alike. A flat 75% black here was a second value that happened to look similar, and
    /// it left the yard reading warm behind cool chrome.
    ///
    /// NOT OPAQUE, and that matters: the fight is still there behind it, and a solid ground would
    /// turn a pause into having left the game.
    /// </remarks>
    private static void Scrim(SpriteBatch batch, Sprites sprites, int vw, int vh) =>
        batch.Draw(sprites.Blank, new Rectangle(0, 0, vw, vh), Palette.Scrim);

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
