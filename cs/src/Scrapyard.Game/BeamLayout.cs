namespace Scrapyard.Game;

/// <summary>
/// The arithmetic behind a laser: layer widths, colour rules, the envelope, and where the
/// travelling energy is. Port of the pure half of <c>src/render/beams.ts</c>.
/// </summary>
/// <remarks>
/// <para>
/// <b>A BEAM IS A ONE-TICK EVENT IN THE SIMULATION.</b> <c>World.Beams</c> is cleared at the start
/// of every tick and refilled by the weapon step, so the geometry drawn is always the geometry the
/// sim published on the tick being read - never interpolated, never extrapolated, never
/// recomputed. A hitscan line that disagrees with where the damage landed is a broken weapon.
/// </para>
/// <para>
/// <b>THE ENVELOPE IS RENDER-ONLY, and it exists because the raw buffer snaps.</b> The sim
/// republishes a beam every tick while it fires and simply stops on the tick it is refused - a
/// blocked line, a dead target, an overheat - which reads as a glitch rather than as a weapon
/// powering down. So each weapon slot carries a 0..1 envelope that climbs while the sim publishes
/// and falls once it stops. The fade draws the LAST PUBLISHED SEGMENT, unchanged, dimming and
/// narrowing in place: it never moves, never lengthens and never spawns impact effects, so the
/// afterglow cannot claim the beam is hitting something the sim did not say it hit. Nothing here
/// is ever written back to <c>World</c>.
/// </para>
/// <para>
/// <b>NO MONOGAME IN HERE</b>, so the tests compile this exact source. Colours are plain
/// <c>0xRRGGBB</c> integers for the same reason, and because the originals are integer maths with
/// no allocation.
/// </para>
/// </remarks>
public static class BeamLayout
{
    /// <summary>
    /// Drawn width of each layer, as a multiple of the weapon's half-width.
    /// </summary>
    /// <remarks>
    /// The multipliers are large and the alphas small because every layer except the core is drawn
    /// with a GRADIENT quad: its edges are transparent, so a layer's stated width is where it has
    /// faded to nothing, not where it stops. The old flat quads had to be narrow to avoid a visible
    /// step, and narrow-and-flat is what read as a plastic tube.
    /// </remarks>
    public const double SheathMul = 3.4;

    public const double CoreMul = 1.5;
    public const double PulseMul = 5.4;
    public const double InnerMul = 4.2;
    public const double OuterMul = 9;

    public const double SheathAlpha = 0.42;
    public const double CoreAlpha = 1;
    public const double InnerAlpha = 0.42;
    public const double OuterAlpha = 0.2;
    public const double PulseAlpha = 0.42;

    /// <summary>Dark warm brown, not black: a neutral rim on a rust floor reads as a hole punched in it.</summary>
    public const int SheathTint = 0x2a1410;

    /// <summary>
    /// How white each layer is pushed. 0 is the weapon's own colour, 1 is white.
    /// </summary>
    /// <remarks>
    /// Kept low on the core: the halo already piles enough light on top of it, and every point of
    /// whitening here is a point of the hue that ties this beam to its heat bar.
    /// </remarks>
    public const double CoreWhiten = 0.16;

    public const double InnerWhiten = 0.1;
    public const double PulseWhiten = 0.34;

    /// <summary>How far the additive layers are pushed towards a pure hue. See <see cref="Purify"/>.</summary>
    public const double OuterPurity = 0.8;

    public const double InnerPurity = 0.4;

    /// <summary>
    /// The envelope, in REAL SECONDS rather than ticks.
    /// </summary>
    /// <remarks>
    /// Seconds so it is identical when the platform clamps the frame rate to 30. IN is fast enough
    /// to still read as "it snapped on"; OUT is longer than IN but still under a tenth of a second,
    /// because a laser that lingers is a laser you think is still firing.
    /// </remarks>
    public const double RampInSec = 0.05;

    public const double FadeOutSec = 0.11;

    /// <summary>
    /// Travelling energy: two pulses per beam, sliding towards the impact at a constant WORLD
    /// speed, so a long laser shows a longer flight and every laser shows the same rate of energy
    /// delivery.
    /// </summary>
    public const int PulsesPerBeam = 2;

    public const double PulseSpeed = 700;

    /// <summary>
    /// Ceiling on how often a pulse may cross, in crossings per second.
    /// </summary>
    /// <remarks>
    /// Constant world speed alone is wrong at the short end: an enemy standing 20 units away turns
    /// speed-over-length into 35 crossings a second, which is a strobe rather than a beam. The cap
    /// binds only where the beam is too short for its speed to be readable anyway, so long lasers
    /// keep the true constant speed and point-blank ones stay calm.
    /// </remarks>
    public const double PulseMaxRate = 3.2;

    public const double PulseFrac = 0.34;
    public const double PulseMaxLen = 70;

    /// <summary>
    /// Breathing and flicker, both shallow, in RADIANS PER SECOND rather than Hz.
    /// </summary>
    /// <remarks>
    /// A beam that strobes reads as a fault, not as power, and the travelling pulses carry most of
    /// the life the flicker used to have to fake. 27 is about 4.3 cycles a second.
    /// </remarks>
    public const double FlickerRate = 27;

    public const double FlickerDepth = 0.08;
    public const double BreatheRate = 9;
    public const double BreatheDepth = 0.07;
    public const double ImpactBeatRate = 21;

    public const double ImpactUnits = 10;
    public const double ImpactHotUnits = 4.2;

    /// <summary>
    /// TWO WIDTH REGIMES, AND THE MULTIPLIERS ONLY EVER MEANT ONE OF THEM.
    /// </summary>
    /// <remarks>
    /// <para>
    /// Every layer is authored as a MULTIPLE of the beam's half-width, which is right for a LINE:
    /// the three ordinary lasers are 1.6 to 2.7 units of half-width, so a 9x halo is 24 units of
    /// soft light around a thin bright thread, which is what light looks like.
    /// </para>
    /// <para>
    /// The Giga Laser broke that by making the half-width mean something else - it is the HITBOX,
    /// since the swath bills every body inside it - so the same multipliers drew a 9.6 unit beam
    /// with an 86 unit halo and a core WIDER THAN THE THING THAT BURNS. On screen: a flat slab of
    /// red with a wash around it, and a square end sticking out of the mech twice the width of the
    /// chassis.
    /// </para>
    /// <para>
    /// So the rule is that THE GLOW IS A RIM, NOT A SCALE. Each layer is the beam's own width plus
    /// an additive rim sized off this reference rather than off the beam. At or below it the
    /// arithmetic is exactly the old multiplication, so the three lasers are unchanged to the last
    /// bit; above it the rim stops growing and a wide beam gets a halo instead of a weather system.
    /// </para>
    /// </remarks>
    public const double RimRef = 3;

    /// <summary>The filament's share of a wide beam's half-width - narrow enough to read as a thread.</summary>
    public const double FilamentFrac = 0.42;

    /// <summary>
    /// How much brighter a wide beam's BODY is drawn, as a multiple of <see cref="InnerAlpha"/>.
    /// </summary>
    /// <remarks>
    /// THE BODY IS THE HITBOX AND IT HAS TO BE LEGIBLE. On a thin laser the inner layer is a soft
    /// halo around a bright core - a suggestion of light, correctly faint. On a swath it is the
    /// actual width of the thing that burns, and a player who cannot see where the burning stops
    /// cannot aim it.
    /// </remarks>
    public const double WideBodyAlpha = 1.9;

    /// <summary>A wide beam's dark sheath, as a multiple of its body - an OUTLINE around the burn channel.</summary>
    public const double WideSheathMul = 1.15;

    /// <summary>Emitter heat glow: diameter at cold and at capacity, in beam half-widths.</summary>
    public const double HeatUnitsCold = 3;

    public const double HeatUnitsHot = 11;
    public const double HeatAlphaCold = 0.1;
    public const double HeatAlphaHot = 0.5;

    /// <summary>Sputter rate while cut out, Hz. Slow enough to read as a struggling emitter.</summary>
    public const double OverheatSputterHz = 7;

    public const double EmberInterval = 0.045;
    public const double ScorchInterval = 0.13;

    /// <summary>The widths of one beam's layers, and how wide it counts as for the alphas.</summary>
    public readonly record struct Widths(
        double Sheath, double Outer, double Inner, double Core, double Pulse, double Wide);

    /// <summary>
    /// Layer widths for a beam of the given half-width.
    /// </summary>
    /// <remarks>
    /// THE CORE GOES THE OTHER WAY as the beam widens - a thread down a channel rather than the
    /// channel itself - and the sheath has to clear the BODY on a wide beam, or the burn channel
    /// has no edge and the swath bleeds into the floor exactly where the player needs to see it
    /// stop. Everything blends on the one <c>wide</c> number so nothing pops at the boundary.
    /// </remarks>
    public static Widths LayerWidths(double half)
    {
        double rf = half < RimRef ? half : RimRef;
        double wide = half <= RimRef ? 0 : System.Math.Min(1, (half - RimRef) / RimRef);

        double outer = half + rf * (OuterMul - 1);
        double inner = half + rf * (InnerMul - 1);
        double pulse = half + rf * (PulseMul - 1);
        double core = half * (CoreMul + (FilamentFrac - CoreMul) * wide);
        double sheathBase = half + rf * (SheathMul - 1);
        double sheath = sheathBase + wide * (inner * WideSheathMul - sheathBase);

        return new Widths(sheath, outer, inner, core, pulse, wide);
    }

    /// <summary>Mixes a 0xRRGGBB towards white. Integer maths, no allocation.</summary>
    public static int Whiten(int colour, double t)
    {
        int r = (colour >> 16) & 0xff, g = (colour >> 8) & 0xff, b = colour & 0xff;
        int rr = (int)(r + (255 - r) * t);
        int gg = (int)(g + (255 - g) * t);
        int bb = (int)(b + (255 - b) * t);
        return (rr << 16) | (gg << 8) | bb;
    }

    /// <summary>
    /// Pushes a colour towards a PURE hue by draining the channel it has least of and
    /// renormalising.
    /// </summary>
    /// <remarks>
    /// A COLOUR RULE FOR ADDITIVE LAYERS SPECIFICALLY. <c>0x4fa8ff</c> carries 79 of 255 red, and
    /// on a floor whose red is already at about 0.72 that red does nothing but move the result
    /// towards white. Draining it and putting the light back into green and blue is what keeps a
    /// blue laser blue over rust orange instead of turning it salmon.
    /// </remarks>
    public static int Purify(int colour, double t)
    {
        int r = (colour >> 16) & 0xff, g = (colour >> 8) & 0xff, b = colour & 0xff;
        double lo = (r < g ? (r < b ? r : b) : g < b ? g : b) * t;
        double span = 255 - lo;
        if (span <= 0) return colour;
        double k = 255 / span;
        return (ClampByte((r - lo) * k) << 16) | (ClampByte((g - lo) * k) << 8) | ClampByte((b - lo) * k);
    }

    private static int ClampByte(double v) => v < 0 ? 0 : v > 255 ? 255 : (int)v;

    public static double Clamp01(double v) => v < 0 ? 0 : v > 1 ? 1 : v;

    public static double Smooth(double t) => t * t * (3 - 2 * t);

    public static double Fract(double v) => v - System.Math.Floor(v);

    /// <summary>One step of a slot's envelope: up while the simulation publishes, down once it stops.</summary>
    public static double StepEnvelope(double env, bool firing, double dtSec)
    {
        if (firing)
        {
            env += dtSec / RampInSec;
            return env > 1 ? 1 : env;
        }
        env -= dtSec / FadeOutSec;
        return env < 0 ? 0 : env;
    }

    /// <summary>How the envelope shapes a beam this frame.</summary>
    /// <remarks>
    /// THE CORE COLLAPSES, IT DOES NOT DISSOLVE. Fading an opaque coloured core by alpha alone
    /// leaves a translucent hue lying over rust orange, and a half-transparent green line on an
    /// orange floor is khaki - the dying beam went muddy rather than dark. So the core narrows to
    /// nothing on the envelope and only starts losing opacity at the very end, while the additive
    /// layers fade the ordinary way. A laser that powers down should pinch out.
    /// </remarks>
    public readonly record struct Shape(
        double WideGlow, double WideCore, double CoreFade, double Flicker, double Breathe,
        double WidthMul, double AlphaMul);

    public static Shape ShapeOf(double env, double phase, double clockSec)
    {
        double wideGlow = 0.35 + 0.65 * Smooth(env);
        double wideCore = Smooth(env);
        double coreFade = env >= 0.45 ? 1 : env / 0.45;
        double ph = phase * 6.2832;
        double flicker = 1 - FlickerDepth * (0.5 + 0.5 * System.Math.Sin(clockSec * FlickerRate + ph));
        double breathe = 1 + BreatheDepth * System.Math.Sin(clockSec * BreatheRate + ph * 1.7);
        return new Shape(wideGlow, wideCore, coreFade, flicker, breathe,
                         wideGlow * breathe, env * flicker);
    }

    /// <summary>One travelling pulse: where along the beam it starts, and how long and bright it is.</summary>
    public readonly record struct Pulse(double From, double Length, double Rise);

    /// <summary>
    /// The travelling energy on one segment.
    /// </summary>
    /// <remarks>
    /// The head slides at a constant world speed and the pulses are evenly spread along the beam
    /// whatever its length. Each link of a chain carries its own, and the per-segment phase offset
    /// makes the energy read as running OUTWARD through the crowd rather than as every link
    /// blinking together. A pulse fades in over the first tenth, so energy appears to LEAVE the
    /// emitter rather than wink into existence in mid-air, and is at full brightness by the time it
    /// reaches the target. Returns how many of <paramref name="into"/> were filled.
    /// </remarks>
    public static int PulsesOn(double len, double phase, int segment, double clockSec,
                               Span<Pulse> into)
    {
        double pulseLen = System.Math.Min(len * PulseFrac, PulseMaxLen);
        double rate = System.Math.Min(PulseSpeed / len, PulseMaxRate);
        double travel = clockSec * rate + phase + segment * 0.37;

        int n = 0;
        for (int k = 0; k < PulsesPerBeam; k++)
        {
            double u = Fract(travel + (double)k / PulsesPerBeam);
            double head = u * len;
            double tail = head - pulseLen;
            double from = tail > 0 ? tail : 0;
            double segLen = head - from;
            if (segLen < 0.5) continue;
            into[n++] = new Pulse(from, segLen, u < 0.12 ? u / 0.12 : 1);
        }
        return n;
    }

    /// <summary>The emitter's heat glow: its diameter, its colour and how strongly it shows.</summary>
    public readonly record struct Heat(double Units, int Tint, double Alpha);

    /// <summary>
    /// The emitter glow for a weapon at this heat.
    /// </summary>
    /// <remarks>
    /// DRAWN WHETHER OR NOT IT IS FIRING, because a laser you cannot fire is exactly when its
    /// strain matters most. Heat reads as a QUADRATIC so the bar's top third is where the emitter
    /// visibly strains, and a cut-out is a slow orange sputter - unmistakably a different state
    /// from "hot but firing" rather than just more of the same glow.
    /// </remarks>
    public static Heat HeatGlow(double heatFrac, bool overheated, double beamWidth, int colour,
                                double clockSec)
    {
        double h2 = heatFrac * heatFrac;
        double alpha = HeatAlphaCold + (HeatAlphaHot - HeatAlphaCold) * h2;
        int tint = Whiten(colour, 0.2 + 0.4 * h2);

        if (overheated)
        {
            double s = 0.45 + 0.55 * (0.5 + 0.5 * System.Math.Sin(clockSec * OverheatSputterHz * 6.2832));
            alpha = 0.55 * s;
            tint = 0xff8a30;
        }

        return new Heat(beamWidth * (HeatUnitsCold + (HeatUnitsHot - HeatUnitsCold) * h2), tint, alpha);
    }
}
