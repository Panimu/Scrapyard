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

    /// <param name="pauseRect">
    /// Where the on-screen pause button was drawn, for the caller's own mouse hit-test - the same
    /// arrangement <see cref="Screens.DrawTitle"/>'s <c>outRects</c> parameter documents. A single
    /// rect rather than a list: this is the one clickable thing the HUD itself draws.
    /// </param>
    /// <remarks>
    /// THE WEB BUILD HAS ONE OF THESE AND THE PORT DID NOT - a touch player has no Escape key, so
    /// <c>.hud__pause</c> is not a nicety there, it is the only way in. A keyboard and a pad both
    /// already reach Pause, which is exactly why this was easy to not notice was missing.
    /// </remarks>
    public static void DrawHud(SpriteBatch batch, Sprites sprites, World w, int vw, int vh,
                               out Rectangle pauseRect)
    {
        var p = w.Player;
        int scale = System.Math.Max(1, vh / 360);
        int small = System.Math.Max(1, scale - 1);

        // TOP-RIGHT, same corner the web build's own `.hud__pause` uses - `top: 10px; right: 12px`
        // scaled up from its 44px CSS tap target.
        int pauseSize = 26 * scale;
        pauseRect = new Rectangle(vw - 10 * scale - pauseSize, 10 * scale, pauseSize, pauseSize);
        Screens.CardFace(batch, sprites, pauseRect, 6 * scale, Panel, Edge,
                         System.Math.Max(1, scale / 2));
        Screens.UiDrawCentred(batch, sprites, "II", pauseRect.Center.X,
                              pauseRect.Y + (pauseRect.Height - UiFont.GlyphH(scale)) / 2, scale,
                              Ink);

        // THE LEVEL, AS A BADGE BESIDE THE PAUSE BUTTON, which is where the web build puts it
        // (`.hud__level` - a 40px rounded square in the top row, cleared by the pause button's tap
        // target). It was a two-letter prefix on the status line under the bars, in the dim ink
        // everything else down there uses, which made the run's single most-consulted number the
        // least visible thing in the corner.
        //
        // IT SIZES TO ITS CONTENTS with a floor, exactly as the web's `min-width` does: "1" and
        // "12" should not move the bars by different amounts, but "100" must still fit.
        string levelText = p.Level.ToString();
        int levelW = System.Math.Max(pauseSize, UiFont.Measure(levelText, scale) + 12 * scale);
        var levelRect = new Rectangle(pauseRect.X - 6 * scale - levelW, pauseRect.Y,
                                      levelW, pauseSize);
        Screens.CardFace(batch, sprites, levelRect, 6 * scale, Panel, Edge,
                         System.Math.Max(1, scale / 2));
        Screens.UiDrawCentred(batch, sprites, levelText, levelRect.Center.X,
                              levelRect.Y + (levelRect.Height - UiFont.GlyphH(scale)) / 2, scale,
                              Ink);

        // Hull. The number is on the bar rather than beside it: at a glance the bar is the answer,
        // and the number is for the moment you want to know exactly how much trouble you are in.
        //
        // THE BARS STOP SHORT OF THE BADGE AND THE BUTTON rather than running under them. They were
        // the full width of the window with the button laid on top, so the right-hand end of the
        // hull bar - the part that empties last, and the part you look at when it is nearly gone -
        // was behind a panel.
        double hpFrac = p.Stats.MaxHp > 0 ? System.Math.Clamp(p.Hp / p.Stats.MaxHp, 0, 1) : 0;
        int barW = levelRect.X - 6 * scale - 12;
        int hpH = HpBarH * scale;
        Bar(batch, sprites, 12, 12, barW, hpH, hpFrac, HpTail, HpHead);

        // CENTRED ON THE BAR, as the web's `.bar__label` is. Left-aligned it collided with the
        // fill's bright head at low HP - white text over the lightest part of the gradient - and
        // sat in empty track at high HP, which is the one time it is least worth reading.
        Screens.UiDrawCentred(batch, sprites,
                              $"{System.Math.Ceiling(p.Hp):0} / {p.Stats.MaxHp:0}",
                              12 + barW / 2, 12 + (hpH - UiFont.GlyphH(small)) / 2, small, Ink);

        // The Energy Shield's rims, drawn as pips rather than folded into the hull bar: a rim is a
        // discrete thing that blocks one hit whatever its size, and a fraction would say otherwise.
        int y = 12 + hpH + BarGap * scale;
        for (int i = 0; i < p.ShieldLayers; i++)
        {
            batch.Draw(sprites.Blank, new Rectangle(12 + i * (7 * scale), y, 5 * scale, 4 * scale),
                       new Color(0x6f, 0xd8, 0xff));
        }
        if (p.ShieldLayers > 0) y += 4 * scale + BarGap * scale;

        double xpFrac = p.XpToNext > 0 ? System.Math.Clamp(p.Xp / p.XpToNext, 0, 1) : 0;
        Bar(batch, sprites, 12, y, barW, XpBarH * scale, xpFrac, XpTail, XpHead);
        y += XpBarH * scale + 4 * scale;

        // NO "LV n" HERE ANY MORE - it is the badge above. Two places showing one number is one
        // place too many, and the one that gets stale is always the one nobody is looking at.
        int mins = (int)(w.RunSec / 60);
        int secs = (int)(w.RunSec % 60);
        Screens.UiDraw(batch, sprites, $"{mins}:{secs:00}   x{w.Stats.Kills:0}", 12, y, small, Dim);

        y += UiFont.LineHeight(small) + 4 * scale;
        DrawLoadout(batch, sprites, w, 12, y, barW, scale);
    }

    /// <summary>
    /// THE LOADOUT ROW - one chip per weapon held, carrying its tier and its LIMITER.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>THE BAR IS THE WEAPON.</b> The port drew an icon and a tier number and stopped, which
    /// leaves out the one thing this row exists for: every gun in this game is gated by something,
    /// and a player who cannot see the gate cannot play the gun. A laser is a duty cycle, a
    /// magazine gun goes away completely for seconds at a time, and a cooldown weapon is a promise
    /// about when it comes back. None of that was on screen.
    /// </para>
    /// <para>
    /// ONE BAR, THREE MEANINGS, chosen by what limits the weapon:
    /// </para>
    /// <list type="bullet">
    /// <item>A BEAM shows HEAT rising toward its own cut-out, with a notch at the resume line.
    /// Heat is hysteretic - it cuts out at capacity and does not come back until it has cooled to
    /// <c>HeatResume</c> - so a bar showing only "how full" would make a weapon just under its
    /// ceiling look like one just over its resume line.</item>
    /// <item>A MAGAZINE shows rounds left, and while reloading shows the magazine REFILLING with a
    /// countdown. A fifteen-second silence with no bar moving reads as a broken gun.</item>
    /// <item>EVERYTHING ELSE shows rearm progress, filling to full at the instant it can fire
    /// again. A gun holding fire for want of a target sits at FULL rather than pretending to rearm
    /// - cooldown is only spent on a shot actually taken.</item>
    /// </list>
    /// <para>
    /// AND THE BAR IS SCALED TO THE WEAPON, never to 100. Capacity is a per-weapon stat that tiers
    /// raise, so a capacity upgrade lengthens the burst instead of making the same heat read as a
    /// smaller fraction - which would look like the upgrade had made the gun cooler.
    /// </para>
    /// </remarks>
    private static void DrawLoadout(SpriteBatch batch, Sprites sprites, World w, int x, int y,
                                    int rowW, int scale)
    {
        if (w.WeaponCount <= 0) return;

        int small = System.Math.Max(1, scale - 1);
        int gap = 4 * scale;
        int icon = 11 * scale;
        int barH = 8 * scale;
        int pad = 3 * scale;
        int chipH = pad * 2 + System.Math.Max(icon, barH);

        // UNDER THE XP BAR, which is where the original puts it - the HUD is a column and this is
        // the row after the bars. The port had it in the BOTTOM-LEFT corner, as far from the hull
        // and the clock as the screen allows, so reading your loadout meant looking away from
        // everything else the HUD is telling you.
        //
        // THE CHIPS SHARE THE BAR'S WIDTH, one per weapon, so a big loadout gets narrower chips
        // rather than a row running off the side of the window.
        int chipW = System.Math.Min(64 * scale,
                                    (rowW - gap * (w.WeaponCount - 1)) / w.WeaponCount);
        if (chipW < icon + pad * 2) chipW = icon + pad * 2;

        int ix = x;
        for (int i = 0; i < w.WeaponCount; i++)
        {
            var inst = w.Weapons[i];
            if (inst.DefId < 0 || inst.DefId >= w.WeaponDefs.Length) continue;
            var def = w.WeaponDefs[inst.DefId];
            var stats = inst.Stats;

            bool beam = def.Kind == WeaponKind.Beam;
            bool mag = stats.AmmoCapacity > 0;
            bool reloading = mag && inst.ReloadLeft > 0;
            // NOT THE SAME QUESTION AS `beam`. The Plasma Thrower is WeaponKind.Projectile and
            // heats exactly like a laser regardless - engaged it pays HeatPerSec, idle it sheds
            // HeatDispersion, at capacity it latches Overheated (see the `hot` flag in the core
            // weapon system, which this mirrors). Gating the heat bar on `beam` alone left its
            // chip reading a cooldown instead - a rearm sweep resetting every shot, never showing
            // the heat actually climbing underneath it, with no resume notch and no warning before
            // a cut-out.
            bool heated = beam || stats.HeatPerSec > 0;

            double capacity = stats.HeatCapacity > 0 ? stats.HeatCapacity : 1;
            double frac;
            if (reloading)
            {
                double total = stats.ReloadTime > 0 ? stats.ReloadTime : 1;
                frac = 1 - inst.ReloadLeft / total;
            }
            else if (mag)
            {
                double rounds = inst.Ammo < 0 ? stats.AmmoCapacity : inst.Ammo;
                frac = rounds / stats.AmmoCapacity;
            }
            else if (heated)
            {
                double heat = inst.Heat < 0 ? 0 : inst.Heat > capacity ? capacity : inst.Heat;
                frac = heat / capacity;
            }
            else
            {
                double total = stats.Cooldown > 0 ? stats.Cooldown : 1;
                double left = inst.CooldownLeft > 0 ? inst.CooldownLeft : 0;
                frac = 1 - left / total;
            }

            frac = System.Math.Clamp(frac, 0, 1);

            // A BEAM'S BAR IS ITS OWN BEAM COLOUR, taken from the catalog rather than restated, so
            // the chip and the line drawn across the field are one number and cannot drift apart.
            // The Plasma Thrower has no beam colour of its own to borrow, so it stays on its
            // catalog chip colour even though it now reads heat like one.
            var fill = beam ? FromPacked(def.BeamColour) : ChipColour(def.Id);
            // OVERHEATED AND RELOADING LOOK DIFFERENT ON PURPOSE. An overheat is a FAULT and takes
            // the warning red; a reload is a procedure that is going to finish, and stays calm.
            if (inst.Overheated) fill = OutColour;

            // THE CHIP IS A PANEL, keyed by the weapon's own colour at the very bottom of its
            // range - enough to say which gun this is without becoming a second thing to look at
            // beside the bar itself.
            var chip = new Rectangle(ix, y, chipW, chipH);
            Screens.CardFace(batch, sprites, chip, 4 * scale, new Color(8, 11, 16) * 0.62f,
                             fill * 0.35f, System.Math.Max(1, scale / 2));

            // AT THE TIER IT IS HELD AT, so an ascended gun wears its own art in the loadout
            // strip rather than the card it was built out of.
            int cardIndex = CardIndexForWeapon(w, inst.DefId);
            var tex = cardIndex >= 0
                ? sprites.Get(CardTexts.At(cardIndex).IconKeyAt(inst.Level))
                : null;
            if (tex is not null)
            {
                batch.Draw(tex, new Rectangle(ix + pad, y + (chipH - icon) / 2, icon, icon),
                           Color.White);
            }

            int bx = ix + pad + icon + pad;
            int bw = chip.Right - pad - bx;
            if (bw <= 0) { ix += chipW + gap; continue; }

            int by = y + (chipH - barH) / 2;
            batch.Draw(sprites.Blank, new Rectangle(bx, by, bw, barH), Palette.Sunken);
            int fw = (int)System.Math.Round(bw * frac);
            if (fw > 0) batch.Draw(sprites.Blank, new Rectangle(bx, by, fw, barH), fill);

            // THE RESUME NOTCH, and only where heat applies: it is a property of heat's hysteresis
            // and says nothing about a magazine or a cooldown.
            if (heated)
            {
                int nx = bx + (int)System.Math.Round(
                    bw * System.Math.Clamp(stats.HeatResume / capacity, 0, 1));
                batch.Draw(sprites.Blank,
                           new Rectangle(nx, by, System.Math.Max(1, scale / 2), barH), Ink);
            }

            // THE READOUT SITS INSIDE THE TRACK rather than under it - the tier normally, and the
            // countdown that replaces it while the gun is away, so "when do I get it back" always
            // has an answer without the row needing a second line to be legible.
            string label = inst.Level.ToString();
            var labelTint = Ink;
            if (inst.Overheated)
            {
                label = "OUT";
                labelTint = Color.White;
            }
            else if (reloading)
            {
                label = inst.ReloadLeft.ToString("0.0");
                labelTint = Color.White;
            }

            // RIGHT-ALIGNED INSIDE THE TRACK, not centred: a beam's resume notch sits at its own
            // threshold, which for every laser in the game is the halfway mark - so a centred
            // readout is drawn exactly on top of it and the two become one illegible smudge.
            int lw = UiFont.Measure(label, small);
            Screens.UiDraw(batch, sprites, label, bx + bw - lw - 2 * scale,
                           by + (barH - UiFont.GlyphH(small)) / 2, small, labelTint);
            ix += chipW + gap;
        }
    }

    /// <summary>A cut-out beam. A fault, and the only warning red on this row.</summary>
    private static readonly Color OutColour = new(0xff, 0x5a, 0x4a);

    /// <summary>
    /// The magazine's brass.
    /// </summary>
    /// <remarks>
    /// DELIBERATELY NOT ANY OF THE THREE BEAM COLOURS AND NOT THE UI ACCENT: the bar has to say
    /// "this is the kinetic gun" at a glance in a row that may also be carrying a green, a blue
    /// and a red laser.
    /// </remarks>
    private static readonly Color MagColour = new(0xe0, 0xb3, 0x4a);

    /// <summary>A packed 0xRRGGBB from the weapon catalog, as a colour.</summary>
    private static Color FromPacked(double packed)
    {
        int v = (int)packed;
        return new Color((v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff);
    }

    /// <summary>
    /// ONE COLOUR PER WEAPON, for everything that is not a beam.
    /// </summary>
    /// <remarks>
    /// A single steel for the whole cooldown family would be truer to the SIMULATION - they share
    /// a limiter - and the chip is not about the simulation. Four grey bars in a row makes "which
    /// of these is my Cannon" a matter of reading four labels on a moving background, and the
    /// answer arrives after the moment it was wanted. A colour is read without being looked at,
    /// which is the whole job of this row.
    ///
    /// BEAMS ARE NOT IN HERE: a laser takes its colour from the catalog, so the bar and the line
    /// on the field are the same value and adding them here would be a second copy of it.
    /// </remarks>
    private static Color ChipColour(int weaponId) => weaponId switch
    {
        WeaponIds.Cannon => new Color(0xff, 0xd9, 0x3d),
        WeaponIds.Drone => new Color(0xee, 0xf3, 0xf8),
        WeaponIds.MissileShort => new Color(0xff, 0x8a, 0x3c),
        WeaponIds.MissileLong => new Color(0xc9, 0x8b, 0xff),
        WeaponIds.Artillery => new Color(0xff, 0x5f, 0x8f),
        WeaponIds.MachineGun or WeaponIds.FlakCannon => MagColour,
        _ => new Color(0x8f, 0xa3, 0xbb),
    };

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
    /// <param name="outRects">
    /// See the parameter of the same name on <see cref="Screens.DrawTitle"/>. Filled with each
    /// card's rect in offer order, then REROLL, then AUTO LEVEL - so the last two entries are
    /// always those two buttons whatever n (up to three) actually offered this pick, and anything
    /// below them is a card.
    /// </param>
    public static void DrawLevelUp(SpriteBatch batch, Sprites sprites, World w, int vw, int vh,
                                   System.Collections.Generic.List<Rectangle>? outRects = null)
    {
        outRects?.Clear();
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

        int rerollH = UiFont.GlyphH(scale) + 12 * scale;
        int autoH = UiFont.LineHeight(small) + 6 * scale;
        int bottom = vh - 12 * scale - autoH - rerollH - 4 * scale;
        int y = bottom - stack;

        Screens.UiDrawCentred(batch, sprites, Screens.Spaced("LEVEL UP"), vw / 2,
                         y - 10 * scale - UiFont.GlyphH(scale * 2) - UiFont.LineHeight(small),
                         small, Faint);
        string owed = lu.Pending > 1 ? $"CHOOSE ONE ({lu.Pending} PENDING)" : "CHOOSE ONE";
        Screens.UiDrawCentred(batch, sprites, owed, vw / 2,
                         y - 8 * scale - UiFont.GlyphH(scale * 2), scale * 2, Ink);

        for (int i = 0; i < n; i++)
        {
            var r = new Rectangle(x0, y, width, heights[i]);
            outRects?.Add(r);
            DrawCard(batch, sprites, w, lu.Offers[i], i, r, radius, scale, small);
            y += heights[i] + gap;
        }

        // REROLL SITS BELOW THE CARDS, not among them. It is not a fourth option - taking it does
        // not spend the level - and a thumb reaching for the bottom card must not find it by
        // accident.
        y += 2 * scale;
        bool canReroll = lu.Rerolls > 0 || w.InfiniteRerolls;
        string reroll = w.InfiniteRerolls ? "REROLL (INFINITE)"
                      : lu.Rerolls > 0 ? $"REROLL ({lu.Rerolls})" : "NO REROLLS LEFT";
        var rerollRect = new Rectangle(x0, y, width, rerollH);
        // Always appended, even when disabled - a click on a dead reroll button is a click that
        // should do nothing, not a click that falls through to whatever is drawn behind it.
        outRects?.Add(rerollRect);
        Screens.OverlayButton(batch, sprites, rerollRect, reroll, "Q", scale, canReroll);
        y += rerollH + 4 * scale;

        // AUTO-LEVEL, OFFERED WHERE IT IS WANTED. The pause menu has the switch, but the moment a
        // player decides they are tired of choosing is the moment a card is in front of them - and
        // making them pause, find a menu and come back is asking them to do the thing they just
        // said they did not want to do.
        //
        // BELOW THE REROLL, which is already below the cards: this is the least-reached control on
        // the screen and the one with the largest consequence, so it sits furthest from the thumb.
        //
        // A BUTTON AND NOT A LINE OF TEXT. It was drawn as the hint "[A] AUTO LEVEL FROM HERE",
        // which names a key and looks like a caption - so on a machine being played with a mouse
        // it was a control that could be read and not pressed. Everything else on this screen is
        // clickable; a player has no reason to guess that this one thing is not.
        var autoRect = new Rectangle(x0, y, width, rerollH);
        outRects?.Add(autoRect);
        Screens.OverlayButton(batch, sprites, autoRect, "AUTO LEVEL FROM HERE", "L", scale, true);
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
        // AT THE TIER BEING OFFERED, so a card can never advertise art the pick does not grant.
        // Level-ups stop at 7, so today this is always the base icon - but the rule is the rule,
        // and the next thing that offers a tier 8 will not need this line found again.
        return (text.Name, tierLine, desc, unlock ? "NEW" : $"TIER {tier}", weapon,
                text.IconKeyAt(tier));
    }

    private static int CardHeight(World w, int offer, int width, int scale, int small)
    {
        var t = CardText(w, offer);
        if (t.Name == "") return 0;

        int textW = width - 14 * scale - 22 * scale;
        int h = 7 * scale + UiFont.GlyphH(scale) + 2 * scale;
        if (t.Tier != "") h += UiFont.LineHeight(small) + 3 * scale;
        h += UiFont.Wrap(t.Desc, textW, small).Count * UiFont.LineHeight(small);
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
        Screens.UiDraw(batch, sprites, $"[{slot + 1}]", r.Right - pad - UiFont.Measure("[9]", small),
                  r.Y + pad, small, Faint);

        int ty = r.Y + pad;
        Screens.UiDraw(batch, sprites, t.Name.ToUpperInvariant(), ix, ty, scale, Ink);
        ty += UiFont.GlyphH(scale) + 2 * scale;

        if (t.Tier != "")
        {
            // DIMMED ON AN ORDINARY TIER so the unlock still reads as the louder card. One number
            // to move rather than a second pair of colours that can drift out of sync.
            Screens.UiDraw(batch, sprites, Screens.Spaced(t.Tier), ix, ty, small,
                      unlock ? key : key * 0.72f);
            ty += UiFont.LineHeight(small) + 3 * scale;
        }

        int textW = r.Width - (ix - r.X) - pad - 22 * scale;
        foreach (string line in UiFont.Wrap(t.Desc, textW, small))
        {
            Screens.UiDraw(batch, sprites, line, ix, ty, small, Dim);
            ty += UiFont.LineHeight(small);
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

        Screens.UiDrawCentred(batch, sprites, "CYBER CHEST", vw / 2, (int)(vh * 0.16), scale * 2,
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
            Screens.UiDrawCentred(batch, sprites, "[1] SKIP", vw / 2, ty + 10 * scale, scale, Dim);
            return;
        }

        if (chest.Ascension >= 0)
        {
            // AN ASCENSION IS THE ONE THING IN THIS GAME MEANT TO BE FOUND, so it is announced
            // rather than folded into the payout line.
            Screens.UiDrawCentred(batch, sprites, "ASCENSION", vw / 2, ty, scale * 2, Accent);
            ty += 20 * scale;

            // NAMED AT WHAT IT BECAME. This said the BASE card's name, so the one screen in the
            // game whose entire job is to announce that the thing in your hands is not the thing
            // you were carrying announced the thing you were carrying.
            var ascCard = CardTexts.At(chest.Ascension);
            string ascName = PediaText.AscensionOf(ascCard.Id) is { } a ? a.Name : ascCard.Name;
            Screens.UiDrawCentred(batch, sprites, ascName.ToUpperInvariant(), vw / 2, ty,
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
                Screens.UiDrawCentred(batch, sprites, word, vw / 2, ty, scale * 2, Accent);
                ty += 20 * scale;
            }
            Screens.UiDrawCentred(batch, sprites, $"{chest.Payout} UPGRADES", vw / 2, ty, scale,
                             Ink);
            ty += 14 * scale;
        }

        if (ChestSpin.GrantsShown(t, landAt[2]))
        {
            for (int i = 0; i < chest.Payout && i < chest.Grants.Length; i++)
            {
                int g = chest.Grants[i];
                if (g < 0) continue;
                // NAMED AT WHAT IT BECAME, not at what it was. A chest that hands over a tier 8
                // and then lists the base card's name is telling the player they won the thing
                // they already had.
                int gTier = g < w.LevelUp.Stacks.Length ? w.LevelUp.Stacks[g] : 0;
                string gName = gTier >= UpgradeCatalog.WeaponAscendedTier
                               && PediaText.AscensionOf(CardTexts.At(g).Id) is { } gAsc
                    ? gAsc.Name
                    : CardTexts.At(g).Name;
                Screens.UiDrawCentred(batch, sprites, gName.ToUpperInvariant(),
                                 vw / 2, ty, scale, Dim);
                ty += UiFont.LineHeight(scale);
            }
        }

        Screens.UiDrawCentred(batch, sprites, "[1] TAKE IT", vw / 2, ty + 10 * scale, scale, Accent);
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

        // AN ASCENSION CHEST SHOWS THE TIER-8 ICON ON ALL THREE REELS, because that is the symbol
        // the spin is about - the same rule the web build's own reel follows. The decoys keep
        // their base art: they are the player's loadout blurring past, not what was won.
        int landedTier = chest.Ascension >= 0 ? UpgradeCatalog.WeaponAscendedTier : 1;

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

            var tex = sprites.Get(CardTexts.At(card).IconKeyAt(index >= tiles ? landedTier : 1));
            if (tex is null) continue;

            // The tile slides up through the window; the one behind it comes in from below.
            int oy = (int)((k - frac) * inner);
            var dst = new Rectangle(x + pad, y + pad + oy, inner, inner);

            // CLIPPED BY HAND rather than with a scissor rectangle: a scissor test is a device
            // state change and this is inside one batch with everything else on screen.
            //
            // THE SOURCE RECTANGLE IS CLIPPED TOO, and that is the whole of the fix. This used to
            // skip only a tile that had left the window ENTIRELY, which is a test that is false for
            // both tiles on almost every frame of a spin: they slide by `inner` pixels, so at any
            // moment one is hanging off the top and the other off the bottom. Both were drawn in
            // full, so the reel showed its icons outside the slot and the drum illusion - a strip
            // turning past a window - collapsed into two pictures sliding over the panel.
            //
            // Taking the same fraction off the TEXTURE that the window takes off the destination is
            // exact at any offset, costs one extra rectangle, and needs no device state at all.
            int winTop = y + pad;
            int winBottom = y + box - pad;
            int visTop = dst.Y > winTop ? dst.Y : winTop;
            int visBottom = dst.Bottom < winBottom ? dst.Bottom : winBottom;
            if (visBottom <= visTop) continue;

            double fromTop = (visTop - dst.Y) / (double)inner;
            double fromBottom = (dst.Bottom - visBottom) / (double)inner;
            int srcTop = (int)(fromTop * tex.Height);
            int srcBottom = tex.Height - (int)(fromBottom * tex.Height);
            // A tile can be a single row tall at the very edge of the window; a source rectangle of
            // zero height draws nothing and would make that row flicker rather than shrink.
            if (srcBottom <= srcTop) srcBottom = srcTop + 1;
            if (srcBottom > tex.Height) srcBottom = tex.Height;

            batch.Draw(tex,
                       new Rectangle(dst.X, visTop, inner, visBottom - visTop),
                       new Rectangle(0, srcTop, tex.Width, srcBottom - srcTop),
                       Color.White);
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

        // WHITE WITH A BLACK OUTLINE, in the interface's own face rather than the blocky fallback.
        // This is the ONE piece of text in the game drawn over the moving field rather than over a
        // panel, so it has no ground of its own to sit on - gold on rust is close to invisible,
        // and the outline is what makes it readable over whatever happens to be underneath.
        string label = name.ToUpperInvariant();
        var shadow = Color.Black * alpha;
        for (int dy = -1; dy <= 1; dy++)
        {
            for (int dx = -1; dx <= 1; dx++)
            {
                if (dx == 0 && dy == 0) continue;
                Screens.UiDrawCentred(batch, sprites, label, px + dx * scale, y + dy * scale,
                                      scale, shadow);
            }
        }

        Screens.UiDrawCentred(batch, sprites, label, px, y, scale, Color.White * alpha);
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

        Screens.UiDrawCentred(batch, sprites, Screens.Spaced("MECH INSURANCE"), vw / 2, y, scale,
                              Dim);
        Screens.UiDrawCentred(batch, sprites, "HULL RESTORED", vw / 2, y + 12 * scale, scale * 2,
                              Accent);
        Screens.UiDrawCentred(batch, sprites, "SPENT - YOU ARE UNTOUCHABLE FOR A MOMENT", vw / 2,
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
    public static void DrawEnd(SpriteBatch batch, Sprites sprites, World w, int vw, int vh,
                               List<Earned>? earned = null, List<Rectangle>? outRects = null)
    {
        Scrim(batch, sprites, vw, vh);
        int scale = Screens.MenuScale(vh);
        int small = Screens.SmallScale(vh);
        int width = Screens.Column(vw, scale);
        int x0 = (vw - width) / 2;
        bool won = w.Phase == RunPhase.Victory;

        int y = 12 * scale;
        Screens.UiDrawCentred(batch, sprites,
                         Screens.Spaced(won ? "SCRAPLORD DOWN" : "RUN OVER"), vw / 2, y, small,
                         Faint);
        y += UiFont.LineHeight(small) + 3 * scale;
        Screens.UiDrawCentred(batch, sprites, won ? "SURVIVED" : "SCRAPPED", vw / 2, y, scale * 2,
                         won ? Good : Palette.Hp);
        y += UiFont.GlyphH(scale * 2) + 10 * scale;

        // TWO WAYS OUT, AND BOTH ARE CLICKABLE. The end of a run is the one screen a player
        // reaches by losing, and it used to offer a single button that only answered a function
        // key - so the mouse that had been playing the game had nothing to press, and there was no
        // way back to the title at all short of quitting.
        int btnH = 27 * scale;
        int backY = vh - 12 * scale - btnH;
        int btnGap = 5 * scale;
        int titleW = UiFont.Measure("TITLE", scale) + UiFont.Measure("ESC", scale) + 24 * scale;
        titleW = System.Math.Min(titleW, width - 40 * scale);

        var titleBtn = new Rectangle(x0, backY, titleW, btnH);
        var againBtn = new Rectangle(x0 + titleW + btnGap, backY, width - titleW - btnGap, btnH);
        Screens.OverlayButton(batch, sprites, titleBtn, "TITLE", "ESC", scale, true);
        Screens.OverlayButton(batch, sprites, againBtn, "NEW RUN", "F5", scale, true);
        if (outRects is not null)
        {
            outRects.Clear();
            outRects.Add(againBtn);
            outRects.Add(titleBtn);
        }

        int bottom = backY - 8 * scale;

        // --- WHAT THE RUN OPENED, above every number ---------------------------------------------
        //
        // IT GOES AT THE TOP, ABOVE THE STATISTICS. A run that earned something has produced
        // exactly one fact worth leading with, and it is not the accuracy percentage.
        //
        // THIS IS THE SECOND HALF OF A PAIR. The corner banner said each of these as it happened,
        // mid-fight, and a banner shown during a boss fight is a banner that may genuinely not have
        // been looked at. The summary is the receipt: the whole haul in one place, read at leisure
        // by someone deciding what to do next. Neither replaces the other.
        //
        // EACH ROW SAYS WHICH KIND IT IS. Three different things land on this list - a mech, a
        // card, a yard - and the web build's own heading used to be "Chassis earned", which
        // cheerfully announced a newly earned CARD as a chassis.
        if (earned is { Count: > 0 })
        {
            int rowH = UiFont.LineHeight(small) + 6 * scale;
            int panelH = UiFont.LineHeight(small) + 6 * scale + earned.Count * rowH + 8 * scale;
            var panel = new Rectangle(x0, y, width, panelH);
            Screens.CardFace(batch, sprites, panel, 6 * scale, Panel, Accent,
                             System.Math.Max(1, scale / 2));

            int ey = y + 6 * scale;
            Screens.UiDraw(batch, sprites, Screens.Spaced("UNLOCKED"), x0 + 8 * scale, ey, small,
                      Accent);
            ey += UiFont.LineHeight(small) + 4 * scale;

            foreach (var e in earned)
            {
                Screens.UiDraw(batch, sprites, e.Name, x0 + 8 * scale, ey, small, Ink);
                // The kind sits hard right, so the names read as a column and the kinds as a
                // second one - which is what stops three rows of two words reading as prose.
                int kw = UiFont.Measure(e.Kind, small);
                Screens.UiDraw(batch, sprites, e.Kind, x0 + width - 8 * scale - kw, ey, small,
                          Faint);
                ey += rowH;
            }

            y += panelH + 4 * scale;
        }

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
        int cellH = 6 * scale + UiFont.LineHeight(small) + UiFont.GlyphH(scale) + 8 * scale;
        int thick = System.Math.Max(1, scale / 2);

        for (int i = 0; i < stats.Count; i++)
        {
            int cy = y + i / 2 * (cellH + gap);
            if (cy + cellH > bottom) break;
            var r = new Rectangle(x0 + i % 2 * (cellW + gap), cy, cellW, cellH);
            Screens.CardFace(batch, sprites, r, 6 * scale, Panel, Edge, thick);

            Screens.UiDraw(batch, sprites, Screens.Spaced(stats[i].K), r.X + 6 * scale,
                      r.Y + 6 * scale, small, Faint);
            Screens.UiDraw(batch, sprites, stats[i].V, r.X + 6 * scale,
                      r.Y + 6 * scale + UiFont.LineHeight(small), scale, Ink);
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

        int listH = 6 * scale + UiFont.LineHeight(small)
                  + (UiFont.LineHeight(small) + scale) * rows.Count + 8 * scale;
        if (y + listH <= bottom)
        {
            var r = new Rectangle(x0, y, width, listH);
            Screens.CardFace(batch, sprites, r, 6 * scale, Panel, Edge, thick);

            int ly = r.Y + 6 * scale;
            Screens.UiDraw(batch, sprites, Screens.Spaced("DAMAGE BY SOURCE"), r.X + 6 * scale, ly,
                      small, Faint);
            ly += UiFont.LineHeight(small) + 2 * scale;

            foreach (var (k, v) in rows)
            {
                Screens.UiDraw(batch, sprites, k, r.X + 6 * scale, ly, small, Dim);
                Screens.UiDraw(batch, sprites, v,
                          r.Right - 6 * scale - UiFont.Measure(v, small), ly, small, Ink);
                ly += UiFont.LineHeight(small) + scale;
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
    /// <summary>One thing this run unlocked, for the end screen's list.</summary>
    /// <param name="Kind">"chassis", "card" or "yard" - three things land on one list.</param>
    public readonly record struct Earned(string Name, string Kind);

    /// <summary>One thing that has just come open, waiting to be announced.</summary>
    /// <param name="Icon">A sprite key - the mech, the card's icon, the yard's plate.</param>
    /// <param name="Eyebrow">What KIND of thing it is. The only part that differs between kinds.</param>
    public readonly record struct Toast(string Icon, string Eyebrow, string Name, string Desc);

    /// <summary>Seconds a banner stays up.</summary>
    /// <remarks>
    /// SIX, NOT FOUR. Four is long enough to read a line you are already looking at; this arrives
    /// while the player is looking somewhere else entirely, and the first second is spent noticing
    /// it at all.
    /// </remarks>
    public const double ToastShowSec = 6;

    /// <summary>Dead time between two banners, so the second reads as a new thing.</summary>
    public const double ToastGapSec = 0.35;

    /// <summary>
    /// The unlock banner: a panel in the bottom corner with the thing's own face on it.
    /// </summary>
    /// <remarks>
    /// <para>
    /// IT WAS CENTRED CAPITALS OVER THE FIGHT - "UNLOCKED" and then "CHASSIS: COPPER", stacked one
    /// per unlock in the middle of the screen. Centre-screen text is the register of a SYSTEM
    /// MESSAGE: "connection lost", "update available", the PWA update prompt. An unlock is the
    /// opposite of that. It is a REWARD, and the visual language every player already knows for one
    /// is a corner panel with a picture of the thing in it.
    /// </para>
    /// <para>
    /// THE PICTURE IS MOST OF THE WORK. The old version had none, so a chassis unlock and a card
    /// unlock were the same two lines of text with a different noun - and the icon is the half that
    /// says WHAT you got without being read.
    /// </para>
    /// <para>
    /// IT SLIDES IN, and the slide is where the six seconds start. `t` is the fraction of the
    /// banner's life still to run, so the last stretch fades rather than vanishing - a banner that
    /// disappears between frames reads as a glitch.
    /// </para>
    /// <para>
    /// IT DOES NOT STOP THE GAME. The first achievement in the game lands on the frame a Cyber
    /// Chest pays out an ascension - in the middle of a fight the player has been building toward
    /// for ten minutes. Taking the input away to acknowledge a trophy would be a punishment for
    /// earning it.
    /// </para>
    /// </remarks>
    public static void DrawToast(SpriteBatch batch, Sprites sprites, List<Toast> queue, double left,
                                 int vw, int vh)
    {
        if (queue.Count == 0 || left <= 0) return;
        var item = queue[0];

        int scale = System.Math.Max(1, vh / 400);
        int small = Screens.SmallScale(vh);
        int pad = 9 * scale;
        int icon = 34 * scale;

        // MEASURED, NOT ASSUMED. The three lines are different lengths and different sizes, and the
        // panel is as wide as the longest of them - a fixed width would either clip a long chassis
        // identity or leave a card's one-word name floating in a wide box.
        int wEyebrow = UiFont.Measure(item.Eyebrow, small);
        int wName = UiFont.Measure(item.Name, scale);
        string desc = Fit(item.Desc, small, 46 * scale);
        int wDesc = UiFont.Measure(desc, small);
        int words = System.Math.Max(wEyebrow, System.Math.Max(wName, wDesc));

        int w = pad + icon + pad + words + pad;
        int h = System.Math.Max(icon + pad * 2,
                                UiFont.LineHeight(small) * 2 + UiFont.LineHeight(scale) + pad * 2);

        // THE SLIDE, and the fade at the end. Both come off the same clock, so a banner cut short
        // by a run ending does not jump.
        double life = left / ToastShowSec;
        double inT = System.Math.Min(1, (1 - life) / 0.06);
        float fade = (float)System.Math.Min(1, life / 0.14);
        int rise = (int)((1 - inT) * 26 * scale);

        int x = vw - w - 12 * scale;
        int y = vh - h - 12 * scale + rise;

        Screens.CardFace(batch, sprites, new Rectangle(x, y, w, h), 5 * scale,
                         Panel * fade, Accent * (0.9f * fade), System.Math.Max(1, scale / 2));

        var tex = sprites.Get(item.Icon);
        if (tex is not null)
        {
            batch.Draw(tex, new Rectangle(x + pad, y + (h - icon) / 2, icon, icon),
                       Color.White * fade);
        }

        int tx = x + pad + icon + pad;
        int ty = y + (h - (UiFont.LineHeight(small) * 2 + UiFont.LineHeight(scale))) / 2;

        Screens.UiDraw(batch, sprites, item.Eyebrow, tx, ty, small, Accent * fade);
        ty += UiFont.LineHeight(small);
        Screens.UiDraw(batch, sprites, item.Name.ToUpperInvariant(), tx, ty, scale, Ink * fade);
        ty += UiFont.LineHeight(scale);
        Screens.UiDraw(batch, sprites, desc, tx, ty, small, Dim * fade);
    }

    /// <summary><paramref name="text"/>, cut to fit, with a trailing dot. See Screens.Fit.</summary>
    private static string Fit(string text, int scale, int room)
    {
        if (room <= 0) return "";
        if (UiFont.Measure(text, scale) <= room) return text;
        for (int n = text.Length - 1; n > 0; n--)
        {
            string cut = text.Substring(0, n) + ".";
            if (UiFont.Measure(cut, scale) <= room) return cut;
        }

        return "";
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

    /// <summary>
    /// One HUD bar: a sunken rounded track, an outline, and a graded fill.
    /// </summary>
    /// <remarks>
    /// <para>
    /// IT WAS TWO FLAT RECTANGLES, which is not what the stylesheet the rest of this build follows
    /// asks for: <c>.bar</c> is a rounded, outlined, sunken track and <c>.bar__fill</c> is a
    /// horizontal GRADIENT. On a screen where every panel and every button is rounded and outlined,
    /// two hard-edged slabs across the top were the one thing that read as placeholder.
    /// </para>
    /// <para>
    /// THE GRADIENT IS NOT DECORATION. It runs from a light head to the bar's own colour, so the
    /// leading edge is the brightest part of the bar - which is the part the eye is actually asked
    /// to find when the question is "how much is left".
    /// </para>
    /// <para>
    /// DRAWN AS COLUMNS, one pixel wide, because a SpriteBatch has no gradient brush and the bar is
    /// a few hundred pixels at most once a frame. The alternative is a baked texture, which would
    /// have to be regenerated whenever a colour moved.
    /// </para>
    /// </remarks>
    /// <summary>
    /// Bar heights and the gap between them, in units of the HUD scale.
    /// </summary>
    /// <remarks>
    /// FROM THE WEB BUILD'S STYLESHEET, where `.bar` is 12px and `.bar--xp` is 7px with a 5px gap.
    /// The port had 8 and 4 with a 3px gap: both thinner, and at a RATIO of 2 rather than 1.7, so
    /// the XP bar read as a hairline under the hull bar rather than as the second of two bars.
    /// </remarks>
    private const int HpBarH = 9;
    private const int XpBarH = 5;
    private const int BarGap = 3;

    /// <summary>
    /// The two ends of each bar's gradient, from the web build's `--hp` / `--xp` and the lighter
    /// stop each one starts from.
    /// </summary>
    /// <remarks>
    /// AUTHORED PER BAR RATHER THAN DERIVED. The head used to be the fill colour plus 60 on every
    /// channel, which is a fine way to make something lighter and a poor way to make it look
    /// designed: on the hull bar it produced a washed pink where the web's own gradient runs to a
    /// warm coral, because +60 on a red that is already at 214 has nowhere to go and only lifts the
    /// green and blue. Two colours per bar, matching the stylesheet.
    /// </remarks>
    private static readonly Color HpHead = new(0xff, 0x7a, 0x5f);
    private static readonly Color HpTail = new(0xd7, 0x50, 0x3f);
    private static readonly Color XpHead = new(0x7f, 0xe0, 0xff);
    private static readonly Color XpTail = new(0x4f, 0xd1, 0xff);

    /// <summary>
    /// The track under both bars - one neutral dark, not a dimmed copy of the fill.
    /// </summary>
    /// <remarks>
    /// The port tinted each track with its own fill colour, so an empty hull bar was a dark RED
    /// trough and an empty XP bar a dark blue one. The web uses `rgba(10, 14, 20, 0.75)` for both,
    /// which is the right call: a track is the SHAPE of the bar, and colouring it says there is
    /// something there when there is not.
    /// </remarks>
    private static readonly Color BarTrack = new(0x0a, 0x0e, 0x14);

    private static void Bar(SpriteBatch batch, Sprites sprites, int x, int y, int w, int h,
                            double frac, Color tail, Color head)
    {
        if (w <= 0 || h <= 0) return;

        int radius = h / 2;
        int thick = System.Math.Max(1, h / 8);
        var track = new Rectangle(x, y, w, h);
        Screens.CardFace(batch, sprites, track, radius, BarTrack * 0.75f, Edge, thick);

        int inner = w - thick * 2;
        int fill = (int)System.Math.Round(inner * System.Math.Clamp(frac, 0, 1));
        if (fill <= 0) return;

        int fy = y + thick;
        int fh = h - thick * 2;
        for (int i = 0; i < fill; i++)
        {
            // Graded across the WHOLE track rather than across the part that is filled, so the
            // colour at a given point on the bar does not move as the bar drains.
            float t = inner > 1 ? i / (float)(inner - 1) : 1f;
            batch.Draw(sprites.Blank, new Rectangle(x + thick + i, fy, 1, fh),
                       Color.Lerp(head, tail, t));
        }
    }
}
