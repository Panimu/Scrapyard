using Microsoft.Xna.Framework.Graphics;

namespace Scrapyard.Game;

/// <summary>
/// The texture table, loaded straight from <c>public/sprites/</c>.
/// </summary>
/// <remarks>
/// <para>
/// NOT THROUGH THE CONTENT PIPELINE. The sprites are already generated (<c>npm run mechs</c> and
/// friends), already checked in, and already shared with the web build. Running them through
/// MonoGame's build step would produce a second copy that can drift from the first, and the first
/// is the one the artist-facing tools write.
/// </para>
/// <para>
/// LOADED LAZILY AND CACHED. There are 431 files and a run touches a small fraction of them - the
/// current level's creatures, one chassis, a handful of props. Loading the lot at startup costs a
/// second of black screen to prepare textures nothing will ask for.
/// </para>
/// </remarks>
public sealed class Sprites
{
    private readonly GraphicsDevice _device;
    private readonly string _root;
    private readonly Dictionary<string, Texture2D?> _cache = new();

    /// <summary>A 1x1 white pixel, for solid fills - the letterbox, bars, flat colour.</summary>
    public Texture2D Blank { get; }

    /// <summary>
    /// A white rounded rectangle with ANTIALIASED edges, for the things drawn at an angle.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b><see cref="Blank"/> IS ONE PIXEL, AND A ROTATED PIXEL HAS NOTHING TO SMOOTH.</b> Every
    /// square-to-the-screen panel in this game is drawn by stretching that one texel, which is
    /// exactly right: its edges land on pixel boundaries and there is nothing to antialias. Rotate
    /// it and the same draw produces a hard staircase down every diagonal, and no sampler state
    /// fixes it - linear filtering interpolates between texels, and a 1x1 texture has no
    /// neighbours to interpolate with.
    /// </para>
    /// <para>
    /// So the coverage is baked in here instead: a texture big enough that the badge MINIFIES onto
    /// it, with each edge pixel carrying the fraction of itself the shape covers. Drawn through
    /// <c>LinearClamp</c> that reads as a clean edge at any angle. It is generated rather than
    /// shipped as a PNG because it is four numbers and a loop, and a file would be one more thing
    /// that can go missing.
    /// </para>
    /// </remarks>
    public Texture2D SoftRect { get; }

    /// <summary>The corner radius <see cref="SoftRect"/> was baked with, in its own texels.</summary>
    /// <remarks>
    /// A caller scaling the texture to a badge scales this with it, which is why the number is
    /// published rather than left as a constant inside the generator.
    /// </remarks>
    public const int SoftRectRadius = 10;

    /// <summary>The size of <see cref="SoftRect"/>, in texels.</summary>
    public const int SoftRectSize = 128;

    /// <summary>A white disc with an ANTIALIASED edge, for the round things.</summary>
    /// <remarks>
    /// SAME ARGUMENT AS <see cref="SoftRect"/>, one shape further along. A circle assembled out of
    /// stretched 1x1 texels is either a staircase or a polygon: Toxic Sludge's pools were drawn as
    /// squares because a square was the only shape a single texel could make cheaply, and a square
    /// puddle is not a puddle. One baked disc draws in one call at any size and any tint.
    /// </remarks>
    public Texture2D SoftDisc { get; }

    /// <summary>The size of <see cref="SoftDisc"/>, in texels.</summary>
    public const int SoftDiscSize = 128;

    /// <summary>
    /// ROUGH DISCS: the same shape with a wandering edge, in <see cref="RoughDiscCount"/> variants.
    /// </summary>
    /// <remarks>
    /// <para>
    /// A TRUE CIRCLE READS AS A UI ELEMENT dropped into the yard - the eye picks one out of a
    /// hand-drawn scene instantly - so Toxic Sludge's pools use these instead. The web build gets
    /// the same effect from a polygon with a wobbling radius; there is no polygon fill in a
    /// SpriteBatch, and a rough edge assembled from several overlapping translucent circles
    /// double-darkens everywhere they overlap. Baking the wobble into the texture is one draw call
    /// and no overlap at all.
    /// </para>
    /// <para>
    /// SEVERAL VARIANTS, chosen per pool, because one shape used everywhere is a logo. Four is
    /// enough with the per-pool ROTATION the caller also applies: four outlines at any angle do
    /// not read as a repeat.
    /// </para>
    /// </remarks>
    public Texture2D[] RoughDisc { get; }

    /// <summary>How many rough variants are baked. See <see cref="RoughDisc"/>.</summary>
    public const int RoughDiscCount = 4;

    /// <summary>
    /// The off-screen pointer: an arrow head with a tail stub, pointing along +X, antialiased.
    /// </summary>
    /// <remarks>
    /// BAKED FOR THE REASON THE OTHER TWO ARE. A SpriteBatch fills rectangles; an arrow is a
    /// triangle and a stub, and assembling one out of rotated 1x1 texels gives a staircase down
    /// both leading edges - on a shape that is always drawn at an angle, which is the worst case.
    ///
    /// THE ORIGIN THE CALLER USES IS THE TIP, at the middle of the right edge, so rotating puts
    /// the point exactly on the screen edge the ray crosses.
    /// </remarks>
    public Texture2D Pointer { get; }

    /// <summary>Width of <see cref="Pointer"/>, in texels. The arrow's full length.</summary>
    public const int PointerW = 64;

    /// <summary>Height of <see cref="Pointer"/>, in texels. Twice the head's half-width.</summary>
    public const int PointerH = 48;

    public Sprites(GraphicsDevice device, string root)
    {
        _device = device;
        _root = root;
        Blank = new Texture2D(device, 1, 1);
        Blank.SetData(new[] { Microsoft.Xna.Framework.Color.White });
        SoftRect = MakeSoftRect(device);
        SoftDisc = MakeSoftDisc(device);
        RoughDisc = new Texture2D[RoughDiscCount];
        for (int i = 0; i < RoughDiscCount; i++) RoughDisc[i] = MakeRoughDisc(device, i);
        Pointer = MakePointer(device);
    }

    /// <summary>
    /// Bakes <see cref="SoftRect"/>: a rounded rectangle whose edge pixels carry partial coverage.
    /// </summary>
    /// <remarks>
    /// COVERAGE BY SUPERSAMPLING, four by four inside each texel, which is enough for an edge that
    /// is going to be minified anyway and is a great deal less code than an analytic solve for the
    /// area of a pixel clipped by a circle. It runs once at startup on a 128x128 grid.
    ///
    /// PREMULTIPLIED, because that is the blend state a SpriteBatch defaults to: colour scaled by
    /// its own alpha. Leaving it straight puts a white fringe around every rotated shape - the
    /// thing this texture exists to remove.
    /// </remarks>
    private static Texture2D MakeSoftRect(GraphicsDevice device)
    {
        const int n = SoftRectSize;
        const int r = SoftRectRadius;
        const int sub = 4;

        var data = new Microsoft.Xna.Framework.Color[n * n];
        for (int y = 0; y < n; y++)
        {
            for (int x = 0; x < n; x++)
            {
                int hits = 0;
                for (int sy = 0; sy < sub; sy++)
                {
                    for (int sx = 0; sx < sub; sx++)
                    {
                        double px = x + (sx + 0.5) / sub;
                        double py = y + (sy + 0.5) / sub;

                        // Distance outside the rounded rect, measured from the inset core the
                        // corners are arcs of - the standard rounded-box test.
                        double dx = System.Math.Max(System.Math.Max(r - px, px - (n - r)), 0);
                        double dy = System.Math.Max(System.Math.Max(r - py, py - (n - r)), 0);
                        if (dx * dx + dy * dy <= (double)r * r) hits++;
                    }
                }

                float a = hits / (float)(sub * sub);
                data[y * n + x] = new Microsoft.Xna.Framework.Color(a, a, a, a);
            }
        }

        var tex = new Texture2D(device, n, n);
        tex.SetData(data);
        return tex;
    }

    /// <summary>
    /// Bakes <see cref="SoftDisc"/>: a filled circle whose edge texels carry partial coverage.
    /// </summary>
    /// <remarks>
    /// The same supersampled coverage and the same premultiplied output as
    /// <see cref="MakeSoftRect"/> - see that method for why both of those are necessary. The circle
    /// is inset half a texel from the edge of the texture so the outermost ring is never clipped by
    /// the texture bounds, which would put a flat side on the disc at large scales.
    /// </remarks>
    private static Texture2D MakeSoftDisc(GraphicsDevice device)
    {
        const int n = SoftDiscSize;
        const int sub = 4;
        const double c = n / 2.0;
        const double r = n / 2.0 - 0.5;

        var data = new Microsoft.Xna.Framework.Color[n * n];
        for (int y = 0; y < n; y++)
        {
            for (int x = 0; x < n; x++)
            {
                int hits = 0;
                for (int sy = 0; sy < sub; sy++)
                {
                    for (int sx = 0; sx < sub; sx++)
                    {
                        double px = x + (sx + 0.5) / sub - c;
                        double py = y + (sy + 0.5) / sub - c;
                        if (px * px + py * py <= r * r) hits++;
                    }
                }

                float a = hits / (float)(sub * sub);
                data[y * n + x] = new Microsoft.Xna.Framework.Color(a, a, a, a);
            }
        }

        var tex = new Texture2D(device, n, n);
        tex.SetData(data);
        return tex;
    }

    /// <summary>
    /// Bakes one variant of <see cref="RoughDisc"/>.
    /// </summary>
    /// <remarks>
    /// <para>
    /// THE RADIUS IS A SUM OF SINES IN THE ANGLE, exactly as the web build's polygon is, so the two
    /// front-ends describe the same kind of shape even though neither can use the other's method.
    /// Frequencies are whole numbers because the radius has to close at 2pi - a fractional one
    /// leaves a step where the outline meets itself.
    /// </para>
    /// <para>
    /// The seed is the variant index run through a cheap mix, which is enough: these are four
    /// blobs, not a noise field, and the only requirement is that they differ.
    /// </para>
    /// </remarks>
    private static Texture2D MakeRoughDisc(GraphicsDevice device, int variant)
    {
        const int n = SoftDiscSize;
        const int sub = 4;
        const double c = n / 2.0;
        // The base radius leaves room for the wobble to push OUTWARD without clipping on the
        // texture bounds, which would flatten one side of the blob.
        const double baseR = n / 2.0 / (1 + Rough) - 0.5;

        uint seed = unchecked((uint)(variant * 2654435761u + 1013904223u));
        System.Span<double> freq = stackalloc double[Lobes];
        System.Span<double> amp = stackalloc double[Lobes];
        System.Span<double> phase = stackalloc double[Lobes];
        for (int i = 0; i < Lobes; i++)
        {
            seed = unchecked(seed * 1664525 + 1013904223);
            freq[i] = 2 + (seed >> 8) % 4;
            seed = unchecked(seed * 1664525 + 1013904223);
            amp[i] = Rough * (0.45 + (seed >> 8) / (double)(1 << 24) * 0.55);
            seed = unchecked(seed * 1664525 + 1013904223);
            phase[i] = (seed >> 8) / (double)(1 << 24) * System.Math.PI * 2;
        }

        var data = new Microsoft.Xna.Framework.Color[n * n];
        for (int y = 0; y < n; y++)
        {
            for (int x = 0; x < n; x++)
            {
                int hits = 0;
                for (int sy = 0; sy < sub; sy++)
                {
                    for (int sx = 0; sx < sub; sx++)
                    {
                        double px = x + (sx + 0.5) / sub - c;
                        double py = y + (sy + 0.5) / sub - c;
                        double dist = System.Math.Sqrt(px * px + py * py);
                        double th = System.Math.Atan2(py, px);

                        double k = 1;
                        for (int i = 0; i < Lobes; i++) k += System.Math.Sin(th * freq[i] + phase[i]) * amp[i];
                        if (dist <= baseR * k) hits++;
                    }
                }

                float a = hits / (float)(sub * sub);
                data[y * n + x] = new Microsoft.Xna.Framework.Color(a, a, a, a);
            }
        }

        var tex = new Texture2D(device, n, n);
        tex.SetData(data);
        return tex;
    }

    /// <summary>Sine terms in a rough disc's edge. Three reads as organic; one is an egg.</summary>
    private const int Lobes = 3;

    /// <summary>How far the radius wanders, as a fraction of it. "Poured", not "splattered".</summary>
    private const double Rough = 0.09;

    /// <summary>
    /// Bakes <see cref="Pointer"/>.
    /// </summary>
    /// <remarks>
    /// The proportions are the web build's own arrow: a head 20 long by 22 across the base, and a
    /// tail 9 long by 7 across. Written here as fractions of the texture so the two front-ends
    /// draw the same shape without sharing a number that would have to be kept in step.
    /// </remarks>
    private static Texture2D MakePointer(GraphicsDevice device)
    {
        const int w = PointerW;
        const int h = PointerH;
        const int sub = 4;

        // Head 20 units, tail 9, so the head starts 9/29 of the way along.
        const double headStart = w * (9.0 / 29.0);
        const double midY = h / 2.0;
        // The tail is 7 across against the head's 22.
        const double tailHalf = midY * (3.5 / 11.0);

        var data = new Microsoft.Xna.Framework.Color[w * h];
        for (int y = 0; y < h; y++)
        {
            for (int x = 0; x < w; x++)
            {
                int hits = 0;
                for (int sy = 0; sy < sub; sy++)
                {
                    for (int sx = 0; sx < sub; sx++)
                    {
                        double px = x + (sx + 0.5) / sub;
                        double py = y + (sy + 0.5) / sub;

                        // The head tapers to nothing at the tip; the tail is a constant stub.
                        double half = px >= headStart
                            ? midY * (w - px) / (w - headStart)
                            : tailHalf;
                        if (System.Math.Abs(py - midY) <= half) hits++;
                    }
                }

                float a = hits / (float)(sub * sub);
                data[y * w + x] = new Microsoft.Xna.Framework.Color(a, a, a, a);
            }
        }

        var tex = new Texture2D(device, w, h);
        tex.SetData(data);
        return tex;
    }

    /// <summary>
    /// The texture for a sprite key, or null if there is no such file.
    /// </summary>
    /// <remarks>
    /// NULL RATHER THAN A THROW, and the caller skips what it cannot draw. A missing sprite should
    /// leave a hole in the picture, not take the window down - the simulation is unaffected either
    /// way, and a run that keeps playing is one you can still diagnose from.
    /// </remarks>
    public Texture2D? Get(string key)
    {
        if (_cache.TryGetValue(key, out var cached)) return cached;

        string path = Path.Combine(_root, key + ".png");
        Texture2D? tex = null;
        if (File.Exists(path))
        {
            using var stream = File.OpenRead(path);
            tex = Texture2D.FromStream(_device, stream);
        }
        _cache[key] = tex;
        return tex;
    }

    /// <summary>The same sprite as a flat silhouette, for a thing that has not been earned.</summary>
    /// <remarks>
    /// <para>
    /// A SEPARATE TEXTURE, not a tint. Drawing the art with a dark tint MULTIPLIES it, so a red
    /// torso stays red and a dark chassis all but disappears - the roster ends up showing which
    /// locked mech is which, and showing it badly. The web build says
    /// <c>filter: brightness(0) invert(0.26)</c>: crush everything to black, then lift the whole
    /// thing to one flat grey. That is a per-pixel operation on the COLOUR while the ALPHA is left
    /// alone, which is exactly a silhouette and is not something a sprite tint can express.
    /// </para>
    /// <para>
    /// BUILT ONCE AND CACHED beside the sprite it came from. There are sixteen chassis and three
    /// yards; the whole set is a few hundred kilobytes and it is built the first time a locked tile
    /// is drawn rather than at startup, because a save with the full roster never needs one.
    /// </para>
    /// </remarks>
    public Texture2D? Silhouette(string key)
    {
        string id = key + "\u0000silhouette";
        if (_cache.TryGetValue(id, out var cached)) return cached;

        var src = Get(key);
        if (src is null)
        {
            _cache[id] = null;
            return null;
        }

        var pixels = new Microsoft.Xna.Framework.Color[src.Width * src.Height];
        src.GetData(pixels);
        for (int i = 0; i < pixels.Length; i++)
        {
            // The alpha is carried through untouched - premultiplied, so the grey is scaled by it
            // and a half-transparent edge pixel stays a half-transparent edge pixel.
            byte a = pixels[i].A;
            pixels[i] = new Microsoft.Xna.Framework.Color(
                (byte)(66 * a / 255), (byte)(66 * a / 255), (byte)(66 * a / 255), a);
        }

        var tex = new Texture2D(_device, src.Width, src.Height);
        tex.SetData(pixels);
        _cache[id] = tex;
        return tex;
    }

    /// <summary>Where the sprites live, found by walking up from the binary to the repository.</summary>
    public static string FindRoot()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null)
        {
            string candidate = Path.Combine(dir.FullName, "public", "sprites");
            if (Directory.Exists(candidate)) return candidate;
            dir = dir.Parent;
        }
        return Path.Combine("public", "sprites");
    }
}
