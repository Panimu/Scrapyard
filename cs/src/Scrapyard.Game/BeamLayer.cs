using Microsoft.Xna.Framework;
using Microsoft.Xna.Framework.Graphics;

using Scrapyard.Core;

namespace Scrapyard.Game;

/// <summary>
/// Laser beams. Port of the drawing half of <c>src/render/beams.ts</c>; every number it uses comes
/// from <see cref="BeamLayout"/>.
/// </summary>
/// <remarks>
/// <para>
/// <b>THE LAYER STACK, bottom to top, and why it is exactly this:</b>
/// </para>
/// <list type="bullet">
/// <item>sheath - NORMAL, dark: a burnt channel under the beam</item>
/// <item>halo, glow, pulses, flares - ADDITIVE: the light</item>
/// <item>core - NORMAL, opaque: the hue</item>
/// </list>
/// <para>
/// <b>THE OPAQUE CORE AND THE DARK SHEATH ARE BOTH ABOUT COLOUR, and both exist because this
/// game's floor is RUST ORANGE, not black.</b> Additive light on a bright warm ground clips every
/// channel and all three lasers come out as the same white line - which is exactly what the first
/// version did on a real screenshot, having looked correct against a dark background. Two
/// defences: the CORE is normal-blended and opaque, so the middle of the beam is the weapon's own
/// hue whatever is behind it and a beam on the field matches its chip on the HUD; and the SHEATH
/// is a dark band slightly wider than the core drawn UNDER the additive run, because a saturated
/// line against rust orange is low contrast and the same line against a dark rim is not.
/// </para>
/// <para>
/// <b>THREE PASSES, WHICH IS THE COST OF THAT.</b> The caller ends its normal batch, this draws
/// the sheaths into it, then an additive batch for the light, then back to normal for the cores.
/// Two blend-state changes for the whole layer.
/// </para>
/// </remarks>
public sealed class BeamLayer
{
    private const int MaxSlots = Constants.WeaponSlots;
    private const int MaxLinks = Constants.MaxChainLinks;

    private readonly Sprites _sprites;
    private readonly Effects _fx;

    // Per slot. Keyed by WEAPON SLOT rather than by buffer position, because the envelope has to
    // survive the frames where the buffer entry is absent - which is the whole point of it.
    private readonly double[] _env = new double[MaxSlots];
    private readonly double[] _phase = new double[MaxSlots];
    private readonly bool[] _firing = new bool[MaxSlots];
    private readonly double[] _half = new double[MaxSlots];
    private readonly int[] _colour = new int[MaxSlots];
    private readonly int[] _segs = new int[MaxSlots];
    private readonly double[] _emberTimer = new double[MaxSlots];
    private readonly double[] _scorchTimer = new double[MaxSlots];
    private readonly bool[] _wasOverheated = new bool[MaxSlots];

    // Per slot per chain link.
    private readonly double[] _x0 = new double[MaxSlots * MaxLinks];
    private readonly double[] _y0 = new double[MaxSlots * MaxLinks];
    private readonly double[] _ang = new double[MaxSlots * MaxLinks];
    private readonly double[] _len = new double[MaxSlots * MaxLinks];
    private readonly bool[] _hit = new bool[MaxSlots * MaxLinks];

    /// <summary>
    /// The cross-width falloff every soft beam layer is drawn with: transparent at both edges,
    /// opaque down the middle.
    /// </summary>
    /// <remarks>
    /// <para>
    /// EVERY LAYER USED TO BE A SOLID RECTANGLE - <c>sprites.Blank</c> stretched - so the sheath,
    /// the halo, the body and the pulses all had hard parallel edges, and stacking four of them
    /// produced a bar with visible steps between the layers rather than a falloff. On a thin laser
    /// that reads as a plastic tube; on the Giga Laser's swath, where the body IS the hitbox and
    /// is tens of units across, it reads as a flat slab with a square end sticking out of the
    /// chassis. The web renderer hit exactly this and fixed it by baking a linear gradient into
    /// the quad's own geometry - see the `soft` GraphicsContext in src/render/beams.ts, whose
    /// comment records that flat quads were "hard-edged whatever the layer count".
    /// </para>
    /// <para>
    /// THE SAME FIVE STOPS as that gradient, so the two renderers have the same cross-section.
    /// A texture rather than geometry because that is the cheap way to say it here: one column of
    /// pixels, sampled across the quad's height, built once.
    /// </para>
    /// <para>
    /// PREMULTIPLIED, because every caller already passes <c>tint * alpha</c> and the sheath is
    /// drawn in the normal (premultiplied) batch while the rest are additive. Storing colour and
    /// alpha already multiplied is what makes one texture correct in both.
    /// </para>
    /// </remarks>
    private Texture2D? _soft;

    private Texture2D Soft(GraphicsDevice gd)
    {
        if (_soft is not null) return _soft;

        const int n = 64;
        var px = new Color[n];
        for (int i = 0; i < n; i++)
        {
            double t = (i + 0.5) / n;
            // 0 -> 0, 0.32 -> 0.55, 0.5 -> 1, 0.68 -> 0.55, 1 -> 0, linear between.
            double a = t <= 0.32 ? t / 0.32 * 0.55
                     : t <= 0.5 ? 0.55 + (t - 0.32) / 0.18 * 0.45
                     : t <= 0.68 ? 1 - (t - 0.5) / 0.18 * 0.45
                     : 0.55 - (t - 0.68) / 0.32 * 0.55;
            byte v = (byte)System.Math.Round(System.Math.Clamp(a, 0, 1) * 255);
            px[i] = new Color(v, v, v, v);
        }
        // One pixel WIDE and n TALL: the quad's height is the beam's width, which is the axis the
        // falloff runs across. The width stretches, so a beam of any length costs the same.
        _soft = new Texture2D(gd, 1, n);
        _soft.SetData(px);
        return _soft;
    }

    public BeamLayer(Sprites sprites, Effects fx)
    {
        _sprites = sprites;
        _fx = fx;
        // A fixed per-slot phase, so two lasers never march in step. Any spread does; this one
        // needs no state beyond the index.
        for (int w = 0; w < MaxSlots; w++) _phase[w] = w * 0.37;
    }

    /// <summary>
    /// Latch what the simulation published this tick and advance every slot's envelope.
    /// </summary>
    /// <remarks>
    /// SEPARATE FROM DRAWING because the envelope and the effect throttles are advanced in real
    /// seconds, once per frame, whether or not the slot has anything on screen. Folding it into the
    /// draw would tie the fade to whichever passes happened to run.
    /// </remarks>
    public void Update(World w, double dtSec, double clockSec, double px, double py)
    {
        System.Array.Clear(_firing);

        // ---- pass 1: latch the published geometry, keyed by weapon slot. ----
        var b = w.Beams;
        for (int i = 0; i < b.Count; i++)
        {
            int slot = b.WeaponIdx[i];
            if (slot >= MaxSlots) continue;
            if (slot >= w.WeaponCount) continue;
            var inst = w.Weapons[slot];
            var def = w.WeaponDefs[inst.DefId];
            // A projectile weapon has beamWidth 0. If one ever lands in this buffer, drawing it
            // would produce an invisible zero-width line - a bug that hides itself - so skip it.
            if (def.BeamWidth <= 0) continue;

            double x0 = b.X0[i], y0 = b.Y0[i];
            double dx = b.X1[i] - x0, dy = b.Y1[i] - y0;

            // The FIRST entry this frame for a slot resets its segment count; the ones after it
            // are the chain's jumps, in the order the simulation published them - muzzle outwards.
            if (!_firing[slot])
            {
                _firing[slot] = true;
                _segs[slot] = 0;
            }
            int s = _segs[slot];
            if (s >= MaxLinks) continue;
            int at = slot * MaxLinks + s;
            _segs[slot] = s + 1;

            _x0[at] = x0;
            _y0[at] = y0;
            _ang[at] = System.Math.Atan2(dy, dx);
            _len[at] = System.Math.Sqrt(dx * dx + dy * dy);
            // A GIGA BEAM IS DRAWN AS WIDE AS IT BURNS: its half-width is the live splash radius,
            // which is the ascension's hitbox, so Shaped Charges visibly widens the beam the moment
            // a tier lands. Everything else keeps its cosmetic def width.
            _half[slot] = def.GigaFrom is int giga && inst.Level >= giga
                ? inst.Stats.SplashRadius
                : def.BeamWidth;
            // BeamColour is a double in the catalog, mirroring the TypeScript `number` it was
            // ported from. Exactly representable, so the cast is lossless.
            _colour[slot] = (int)def.BeamColour;
            // The dense enemy index is NOT resolved to an enemy here and must never be: reaping the
            // dead can invalidate it before this layer runs. Only the sentinel test is safe.
            _hit[at] = b.EnemyDense[i] != BeamBuffer.NoBeamTarget;
        }

        // ---- pass 2: advance the envelope, and the emitter that shows even when idle. ----
        for (int slot = 0; slot < MaxSlots; slot++)
        {
            bool firing = _firing[slot];
            double before = _env[slot];
            _env[slot] = BeamLayout.StepEnvelope(before, firing, dtSec);

            if (slot >= w.WeaponCount) continue;
            var inst = w.Weapons[slot];
            var def = w.WeaponDefs[inst.DefId];
            if (def.BeamWidth <= 0) continue;

            // THE EMITTER IS AT THE HARDPOINT, FIRING OR NOT, and both branches have to agree on
            // that, because the player sees them one after the other: the glow strains at the
            // mount, the beam leaves from the mount, the cut-out sputters at the mount.
            //
            // While firing, the published origin, so the glow sits exactly on the beam whatever the
            // sim did with it - and at the slot's FIRST segment. A bare [slot] would read slot 0's
            // chain links for every slot above the first, putting one laser's heat glow on
            // another's jump, or at the world origin with nothing latched.
            double mx, my;
            if (firing)
            {
                mx = _x0[slot * MaxLinks];
                my = _y0[slot * MaxLinks];
            }
            else
            {
                // Otherwise the hardpoint itself, rotated by the chassis FACING - the same
                // body-space offset the simulation casts its ray from. It used to be a point down
                // the AIM vector from the chassis centre, which left a laser cooling on the left
                // shoulder with its heat glow floating out in front of the nose.
                var hp = WeaponCatalog.LaserHardpoint(w, slot);
                double fx = w.Player.FaceX, fy = w.Player.FaceY;
                mx = px + hp.X * fx - hp.Y * fy;
                my = py + hp.X * fy + hp.Y * fx;
            }

            if (inst.Overheated && !_wasOverheated[slot])
            {
                // The cut-out itself: one bright sputter at the muzzle, on the edge only.
                _fx.OverheatBurst(mx, my, FromHex((int)def.BeamColour));
            }
            _wasOverheated[slot] = inst.Overheated;

            double cap = inst.Stats.HeatCapacity;
            double heatFrac = cap > 0 ? BeamLayout.Clamp01(inst.Heat / cap) : 0;
            var heat = BeamLayout.HeatGlow(heatFrac, inst.Overheated, def.BeamWidth,
                                           (int)def.BeamColour, clockSec);
            if (heat.Alpha > 0.01) _pendingHeat[slot] = (mx, my, heat);
            else _pendingHeat[slot] = null;

            // The ignition flash, once, on the frame the envelope leaves zero.
            if (firing && before <= 0 && _segs[slot] > 0)
            {
                _fx.BeamStart(_x0[slot * MaxLinks], _y0[slot * MaxLinks],
                              FromHex(BeamLayout.Whiten((int)def.BeamColour, 0.5)));
            }

            // Debris and scorch spawn ONLY while the sim is actually publishing, on a real-seconds
            // throttle so the rate does not change with frame rate. THE THROTTLE IS PER WEAPON and
            // the debris comes off the FIRST contact: a ten-link chain spitting ten streams of
            // embers would bury the horde it is drawn over.
            if (firing && _segs[slot] > 0 && _hit[slot * MaxLinks])
            {
                int at = slot * MaxLinks;
                double ux = System.Math.Cos(_ang[at]), uy = System.Math.Sin(_ang[at]);
                double x1 = _x0[at] + ux * _len[at], y1 = _y0[at] + uy * _len[at];

                _emberTimer[slot] += dtSec;
                if (_emberTimer[slot] >= BeamLayout.EmberInterval)
                {
                    _emberTimer[slot] = 0;
                    _fx.BeamEmber(x1, y1, -ux, -uy, FromHex(BeamLayout.Whiten(_colour[slot], 0.35)));
                }
                _scorchTimer[slot] += dtSec;
                if (_scorchTimer[slot] >= BeamLayout.ScorchInterval)
                {
                    _scorchTimer[slot] = 0;
                    _fx.Scorch(x1, y1, _half[slot] * 4.5);
                }
            }
        }
    }

    private readonly (double X, double Y, BeamLayout.Heat H)?[] _pendingHeat =
        new (double, double, BeamLayout.Heat)?[MaxSlots];

    /// <summary>The dark burn channel, drawn into the caller's NORMAL batch under the light.</summary>
    /// <remarks>
    /// The sheath fades on the SQUARE of the envelope, so the dark band is always gone before the
    /// light is: it exists to make a bright beam readable, never to outlive one.
    /// </remarks>
    public void DrawSheaths(SpriteBatch batch, Camera cam)
    {
        // SOFT: the sheath is an outline around the burn channel, and a hard-edged one draws a
        // second visible bar rather than a shadow under the first.
        var soft = Soft(batch.GraphicsDevice);
        foreach (var l in _live)
        {
            Quad(batch, cam, soft, _x0[l.At], _y0[l.At], _ang[l.At], _len[l.At],
                 l.Widths.Sheath * l.Shape.WidthMul, FromHex(BeamLayout.SheathTint),
                 BeamLayout.SheathAlpha * l.Env * l.Env);
        }
    }

    /// <summary>The light: halo, body, travelling pulses and every flare. ADDITIVE batch.</summary>
    public void DrawGlow(SpriteBatch batch, Camera cam, double clockSec)
    {
        var flash = _sprites.Get("fx_flash");
        Span<BeamLayout.Pulse> pulses = stackalloc BeamLayout.Pulse[BeamLayout.PulsesPerBeam];

        // The emitter glow first: it sits behind the beam that leaves it.
        for (int slot = 0; slot < MaxSlots; slot++)
        {
            if (_pendingHeat[slot] is not { } ph || flash is null) continue;
            Flare(batch, cam, flash, ph.X, ph.Y, ph.H.Units, FromHex(ph.H.Tint), ph.H.Alpha);
        }

        // SOFT for the three light layers below. Only the core - drawn in its own pass further
        // down - stays a hard quad, exactly as the web keeps one `hard` context for it: the core
        // is the filament, and a filament with soft edges is not a filament.
        var soft = Soft(batch.GraphicsDevice);
        foreach (var l in _live)
        {
            int slot = l.Slot, at = l.At;
            var shape = l.Shape;
            var lw = l.Widths;
            double x0 = _x0[at], y0 = _y0[at], angle = _ang[at], len = _len[at];
            double ux = System.Math.Cos(angle), uy = System.Math.Sin(angle);
            int colour = _colour[slot];
            int s = at - slot * MaxLinks;

            Quad(batch, cam, soft, x0, y0, angle, len, lw.Outer * shape.WidthMul,
                 FromHex(BeamLayout.Purify(colour, BeamLayout.OuterPurity)),
                 BeamLayout.OuterAlpha * shape.AlphaMul);

            // One purify for the two mid layers; the pulse is the same light, just whiter.
            int pure = BeamLayout.Purify(colour, BeamLayout.InnerPurity);
            double bodyAlpha = BeamLayout.InnerAlpha
                             * (1 + (BeamLayout.WideBodyAlpha - 1) * lw.Wide);
            Quad(batch, cam, soft, x0, y0, angle, len, lw.Inner * shape.WidthMul,
                 FromHex(BeamLayout.Whiten(pure, BeamLayout.InnerWhiten)),
                 bodyAlpha * shape.AlphaMul);

            int np = BeamLayout.PulsesOn(len, _phase[slot], s, clockSec, pulses);
            for (int k = 0; k < np; k++)
            {
                var p = pulses[k];
                Quad(batch, cam, soft, x0 + ux * p.From, y0 + uy * p.From, angle, p.Length,
                     lw.Pulse * shape.WidthMul,
                     FromHex(BeamLayout.Whiten(pure, BeamLayout.PulseWhiten)),
                     BeamLayout.PulseAlpha * shape.AlphaMul * p.Rise);
            }

            if (flash is null) continue;

            // THE MUZZLE BELONGS TO THE SHOT, NOT TO EVERY LINK: a jump starts on a body that
            // already has the previous link's impact bloom on it, and a second flare would double
            // it. All three flares are sized off the DRAWN OUTER WIDTH rather than off the
            // half-width, because that is the edge actually needing covered - on a swath a flare
            // keyed to `half` is narrower than the beam and the slab starts dead flat on the hull.
            if (s == 0)
            {
                double capW = lw.Outer * shape.WidthMul * 2.2;
                // The BACKWASH: the cap pulled slightly behind the origin, so a little of the
                // beam's own light lands on the chassis it is mounted to.
                Flare(batch, cam, flash, x0 - ux * capW * 0.10, y0 - uy * capW * 0.10, capW,
                      FromHex(BeamLayout.Whiten(colour, 0.35)), 0.34 * shape.AlphaMul);
                // The CAP, wide enough to swallow the quad's square end whole.
                Flare(batch, cam, flash, x0, y0, capW * 0.62,
                      FromHex(BeamLayout.Whiten(colour, 0.5)), 0.5 * shape.AlphaMul);
                // The THROAT, tighter and whiter and a little way FORWARD, so the brightest point
                // sits just outside the hull the way a real emitter's would.
                Flare(batch, cam, flash, x0 + ux * lw.Core * 1.6, y0 + uy * lw.Core * 1.6,
                      lw.Core * 3.4 * shape.WidthMul,
                      FromHex(BeamLayout.Whiten(colour, 0.82)), 0.6 * shape.AlphaMul);
            }

            // Contact ONLY when the beam actually stopped on a body. Reaching full range through
            // empty air means no bloom: one hanging out there would read as a hit that never
            // happened.
            if (_hit[at])
            {
                double x1 = x0 + ux * len, y1 = y0 + uy * len;
                double beat = 0.88 + 0.24 * (0.5 + 0.5 * System.Math.Sin(
                    clockSec * BeamLayout.ImpactBeatRate + _phase[slot] * 6.2832));
                double bloom = beat * shape.WideGlow;
                Flare(batch, cam, flash, x1, y1,
                      lw.Inner * (BeamLayout.ImpactUnits / BeamLayout.InnerMul) * bloom,
                      FromHex(BeamLayout.Whiten(colour, 0.45)), 0.85 * shape.AlphaMul);
                // The hot centre stays keyed to the FILAMENT, so the contact point is a point
                // rather than a second wide blob.
                Flare(batch, cam, flash, x1, y1,
                      lw.Core * (BeamLayout.ImpactHotUnits / BeamLayout.CoreMul) * bloom,
                      FromHex(0xfff2e0), 0.9 * shape.AlphaMul);
            }
        }
    }

    /// <summary>The opaque hue down the middle, drawn back in the NORMAL batch.</summary>
    public void DrawCores(SpriteBatch batch, Camera cam)
    {
        var blank = _sprites.Blank;
        foreach (var l in _live)
        {
            Quad(batch, cam, blank, _x0[l.At], _y0[l.At], _ang[l.At], _len[l.At],
                 l.Widths.Core * l.Shape.WideCore * l.Shape.Breathe,
                 FromHex(BeamLayout.Whiten(_colour[l.Slot], BeamLayout.CoreWhiten)),
                 BeamLayout.CoreAlpha * l.Shape.CoreFade * l.Shape.Flicker);
        }
    }

    /// <summary>One segment of one slot, with everything the three passes need already worked out.</summary>
    private readonly record struct Live(
        int Slot, int At, double Env, BeamLayout.Shape Shape, BeamLayout.Widths Widths);

    private readonly List<Live> _live = new();

    /// <summary>
    /// Work out which segments are on screen, once.
    /// </summary>
    /// <remarks>
    /// <para>
    /// EVERY SEGMENT THE SLOT PUBLISHED, joined end to end. For an ordinary laser that is one; for
    /// a live chain it is the shot from the muzzle followed by its jumps, and drawing only the last
    /// of them was what left a Chain Laser hanging in the crowd with nothing attaching it to the
    /// mech.
    /// </para>
    /// <para>
    /// BUILT ONCE RATHER THAN PER PASS, so the sheath, the light and the core cannot disagree about
    /// a beam's width or its flicker - they are three parts of one line, and a beam whose dark rim
    /// was computed a frame's worth of phase away from its core has a visible edge.
    /// </para>
    /// </remarks>
    private void CollectLive()
    {
        _live.Clear();
        for (int slot = 0; slot < MaxSlots; slot++)
        {
            double env = _env[slot];
            if (env <= 0) continue;

            var shape = BeamLayout.ShapeOf(env, _phase[slot], _clockSec);
            var lw = BeamLayout.LayerWidths(_half[slot]);

            for (int s = 0; s < _segs[slot]; s++)
            {
                int at = slot * MaxLinks + s;
                // A sub-unit segment is a body standing inside the muzzle: no readable direction,
                // and a quad scaled by nearly zero is a smear of a pixel. The sim's damage still
                // lands and the body's own hit spark shows it. Skipped here rather than dropped at
                // latch time, so the jumps that follow keep their place in the chain.
                if (_len[at] < 1) continue;
                _live.Add(new Live(slot, at, env, shape, lw));
            }
        }
    }

    private double _clockSec;

    /// <summary>The frame's clock, latched once so all three passes shape a beam identically.</summary>
    public void BeginFrame(double clockSec)
    {
        _clockSec = clockSec;
        CollectLive();
    }

    /// <summary>
    /// One beam segment as a quad: a stretched white pixel, centred on its own long axis.
    /// </summary>
    /// <remarks>
    /// The original moves ONE shared unit quad per layer - position, rotation, scale, tint - so a
    /// segment costs four transform writes and no geometry work. A SpriteBatch draw is the same
    /// idea already: the origin at the strip's left edge and half its height puts the quad's start
    /// on the hardpoint and centres its width on the beam's axis.
    /// </remarks>
    /// <summary>
    /// One beam layer. <paramref name="tex"/> is the 1x1 blank for the hard core and the falloff
    /// strip for everything else - see <see cref="Soft"/>.
    /// </summary>
    /// <remarks>
    /// Scaled by the TEXTURE'S OWN SIZE rather than by 1, which the blank made it easy not to
    /// notice: with a 1x64 strip the height must be divided by 64 or the beam is drawn sixty-four
    /// times too wide.
    /// </remarks>
    private static void Quad(SpriteBatch batch, Camera cam, Texture2D tex, double x, double y,
                             double angle, double length, double width, Color tint, double alpha)
    {
        if (alpha <= 0.004 || width <= 0 || length <= 0) return;
        var scale = new Vector2((float)(length * cam.Scale / tex.Width),
                                (float)(width * cam.Scale / tex.Height));
        batch.Draw(tex, cam.ToScreen(x, y), null, tint * (float)alpha, (float)angle,
                   new Vector2(0, tex.Height / 2f), scale, SpriteEffects.None, 0f);
    }

    private static void Flare(SpriteBatch batch, Camera cam, Texture2D tex, double x, double y,
                              double units, Color tint, double alpha)
    {
        if (alpha <= 0.004 || units <= 0) return;
        var scale = new Vector2((float)(units * cam.Scale / tex.Width));
        batch.Draw(tex, cam.ToScreen(x, y), null, tint * (float)alpha, 0f,
                   new Vector2(tex.Width / 2f, tex.Height / 2f), scale, SpriteEffects.None, 0f);
    }

    private static Color FromHex(int c) => new((c >> 16) & 0xff, (c >> 8) & 0xff, c & 0xff);
}
