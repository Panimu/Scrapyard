namespace Scrapyard.Game;

/// <summary>
/// Where the roads run. The decision half of <see cref="GroundPaths"/>, with no MonoGame in it.
/// </summary>
/// <remarks>
/// <para>
/// <b>SPLIT OFF SO THE TEST CAN COMPILE THIS EXACT SOURCE.</b> The test project does not reference
/// MonoGame - a headless run should not load SDL to check a hash - so the alternative was to
/// transcribe the layout a second time into the test and compare two transcriptions. That verifies
/// that two things somebody wrote agree, and the one the game actually draws with is only one of
/// them; a copy that drifts is a green test over a wrong yard. The test project
/// <c>&lt;Compile Include&gt;</c>s this file instead.
/// </para>
/// <para>
/// <b>THE PORT'S JOB IS THE SAME ROADS, NOT ROADS.</b> Two spellings in here compile, run, and
/// quietly lay a different network: the hash's first mix is a plain float64 multiply rather than
/// <c>Math.imul</c>, and <c>&gt;&gt;&gt;</c> is a logical shift rather than an arithmetic one. A
/// third - JavaScript rounding halves up where C# rounds them to even - is real in the language but
/// turns out to be UNREACHABLE here, and the fixture generator established that by trying rather
/// than by argument. See <see cref="JsMath"/> and <c>tools/ground_paths_fixture.ts</c>.
/// </para>
/// </remarks>
public sealed class GroundPathsLayout
{

    /// <summary>World units per cell. The tiles are 64 px authored at 1 px per unit.</summary>
    public const double Cell = 64;

    /// <summary>
    /// Cells per band. At most one road per band per axis, so this sets the spacing - and the room
    /// a road has to wander in, since a road never leaves the band it belongs to.
    /// </summary>
    public const int Band = 12;

    /// <summary>
    /// How far a road swings from its band's centre line, in cells.
    /// </summary>
    /// <remarks>
    /// At 4 a road uses nearly all the room it has while still leaving a cell of margin at each
    /// band edge, so two roads in neighbouring bands can never end up adjacent and be drawn as one
    /// two-lane motorway. It is also half of the slope budget below - do not raise it without
    /// reading that.
    /// </remarks>
    private const int Amp = 4;

    /// <summary>
    /// The two wavelengths the wander is built from, in cells.
    /// </summary>
    /// <remarks>
    /// Coprime, so they never line up into a repeating shape, and both long enough that a road
    /// holds a heading for a while: 16 cells is about 1000 units, so a full swing is roughly one
    /// screen. Dropping them makes roads wobble per-cell, which reads as a jagged mess rather than
    /// as a road that bends. They are also a correctness constraint - see the slope budget.
    /// </remarks>
    private const int WaveLong = 16;

    private const int WaveShort = 9;

    /// <summary>Weight of the long wave. The short one is detail on it, not an equal partner.</summary>
    private const double WaveMix = 0.7;

    // THE SLOPE BUDGET, WHICH IS WHAT KEEPS THE RINGS AWAY. Read this before touching Amp or
    // either wavelength.
    //
    // Smoothstepped value noise changes at most 1.5 / period per cell, so the centreline moves at
    // most  2 * Amp * 1.5 * (WaveMix / WaveLong + (1 - WaveMix) / WaveShort)  cells per step. Keep
    // that UNDER 1 and the road can never move more than one cell at a time, which caps a row's
    // span at two cells. A 2x2 block of road - the thing that draws as a closed ring - then needs
    // two consecutive spans covering the same pair, which is exactly the one-row spike that ColAt
    // flattens. So the two rules together make rings IMPOSSIBLE rather than rare, and the original
    // audited five seeds and 195 000 cells to confirm it.
    //
    // At the values above the budget is 0.925. Amp 5, or WaveShort 5, puts it over 1 and the little
    // roundabouts come straight back - measured in the original rather than guessed: 4 / 11 / 5
    // scored 1.51 and put a ring in roughly every screen.

    /// <summary>Fraction of bands with no road at all, which is what makes the spacing irregular.</summary>
    /// <remarks>
    /// A guaranteed road every N units is a grid however much you bend it. At about a fifth empty
    /// the spacing is genuinely irregular: sometimes two roads close together, sometimes a long
    /// walk between them.
    /// </remarks>
    private const double BandSkip = 0.2;

    /// <summary>
    /// Per-cell chance a road cell has worn away.
    /// </summary>
    /// <remarks>
    /// The dial that decides whether the yard looks abandoned or bombed. At 0.3 the roads stop
    /// being followable and at 0.04 they look brand new; at 0.13 it threw off two-cell fragments
    /// often enough that they read as litter rather than as a road that used to be there, which is
    /// the failure this number is really guarding against. Erosion is also where the END CAPS in
    /// the tile set come from.
    /// </remarks>
    private const double Erosion = 0.1;

    public const double Alpha = 0.5;
    private const double WearMin = 0.66;
    private const double WearMax = 1.15;

    /// <summary>Returned by the column/row lookups for a band that has no road in it.</summary>
    private const int NoRoad = 0x7fffffff;

    // Salts, so the two axes and the erosion roll never share a decision for the same number.
    private const int SaltCol = unchecked((int)0x9e3779b1);
    private const int SaltRow = unchecked((int)0x85ebca6b);
    private const int SaltSkip = unchecked((int)0xc2b2ae35);
    private const int SaltRot = unchecked((int)0x27d4eb2f);
    private const int SaltWear = unchecked((int)0x165667b1);

    private int _seed;

    /// <summary>
    /// Centrelines already worked out this frame, cleared every draw.
    /// </summary>
    /// <remarks>
    /// The layout is a pure function and could be recomputed every time, but the mask asks about
    /// five cells and each of those needs the centreline at three positions to check for a spike,
    /// so the same column gets derived around sixty times per cell without this. THE CACHE CHANGES
    /// NO ANSWER - it is the same pure function with its results kept for the length of one frame,
    /// which is also why it is cleared each frame: the camera moves, so last frame's cells are
    /// mostly the wrong ones, and a cache that grew forever would be a slow leak in a layer nobody
    /// is looking at.
    /// </remarks>
    private readonly Dictionary<long, int> _colMemo = new();

    private readonly Dictionary<long, int> _rowMemo = new();

    /// <summary>The seed is the only thing that decides where the roads run.</summary>
    public void Begin(int seed)
    {
        _seed = seed;
        NewFrame();
    }

    /// <summary>
    /// Drop the centreline cache. Called once per frame by the drawing half.
    /// </summary>
    /// <remarks>
    /// The camera moves, so last frame's cells are mostly the wrong ones, and a cache that grew
    /// forever would be a slow leak in a layer nobody is looking at. Dropping it CHANGES NO ANSWER:
    /// every entry is a value of a pure function of the seed and the coordinate.
    /// </remarks>
    public void NewFrame()
    {
        _colMemo.Clear();
        _rowMemo.Clear();
    }

    /// <summary>
    /// As <see cref="GroundCover"/>'s, and for the same reason - the lookup must be seekable by
    /// coordinate.
    /// </summary>
    /// <remarks>
    /// The three terms are PLAIN multiplies, so they are float64 and lose bits past 2^53 before the
    /// <c>^</c> coerces them to int32; the two mixes below ARE <c>Math.imul</c> and genuinely wrap.
    /// Treating the two cases alike is exactly how the cover layer's port was got wrong first time
    /// round, and it produced a yard that looked completely correct.
    /// </remarks>
    public static uint Hash(int x, int y, int seed)
    {
        int h = JsMath.ToInt32((double)x * 0x27220a95u)
              ^ JsMath.ToInt32((double)y * 0x165667b1u)
              ^ JsMath.ToInt32((double)seed * 0x9e3779b1u);

        unchecked
        {
            h = (int)((uint)h ^ ((uint)h >> 16)) * unchecked((int)0x7feb352d);
            h = (int)((uint)h ^ ((uint)h >> 15)) * unchecked((int)0x846ca68b);
            h = (int)((uint)h ^ ((uint)h >> 16));
            return (uint)h;
        }
    }

    /// <summary>
    /// Floor division that behaves for negative coordinates - the yard is centred on the origin.
    /// </summary>
    /// <remarks>
    /// C# integer division truncates towards zero, so <c>-1 / 12</c> is 0 and cell -1 would be put
    /// in band 0 alongside cell 0. That folds the whole negative half of the yard onto the positive
    /// half by one cell and puts a seam down the middle of the arena.
    /// </remarks>
    private static int FloorDiv(int cell, int by) => (int)System.Math.Floor((double)cell / by);

    public static int FloorDiv(double cell, double by) => (int)System.Math.Floor(cell / by);

    /// <summary>[0, 1) from a hash.</summary>
    private static double Unit(uint h) => (h >> 8) / (double)0x1000000;

    /// <summary>
    /// One octave of value noise along a line: a hashed value every <paramref name="period"/>
    /// cells, smoothly blended between. This is what turns a road from a lattice into a curve.
    /// </summary>
    /// <remarks>
    /// SMOOTHSTEP RATHER THAN LINEAR between the control points, and it is not cosmetic. Linear
    /// interpolation gives a road a constant sideways drift and then an abrupt change of heading at
    /// every control point, which is a zigzag. Smoothstep flattens the ends, so the road HOLDS A
    /// HEADING near each control point and does its turning in between - which is what a road that
    /// bends looks like, as opposed to a road that has been folded.
    /// </remarks>
    private static double VNoise(int t, int period, int salt)
    {
        int i = FloorDiv(t, period);
        double f = (t - (double)i * period) / period;
        double a = Unit(Hash(i, 0, salt));
        double b = Unit(Hash(i + 1, 0, salt));
        double s = f * f * (3 - 2 * f);
        return a + (b - a) * s;
    }

    /// <summary>Whether band <paramref name="b"/> on this axis carries a road at all.</summary>
    /// <remarks>
    /// PUBLIC SO THE THRESHOLD CAN BE ASKED DIRECTLY. Both sides of the comparison are integers in
    /// practice - 204.8 means 205 - so a port that scaled by 1000 instead of 1024 would agree with
    /// the original on every band except the five hash values in between. A window of cells catches
    /// that only if a straggler happens to land in the gap, and when it was injected, none did. The
    /// fixture searches for hashes ON the boundary and asks this method about them.
    /// </remarks>
    public bool BandHas(int b, int axis) =>
        Hash(b, axis, _seed ^ SaltSkip) % 1024 >= BandSkip * 1024;

    /// <summary>Whether a road cell has survived rather than worn away. See <see cref="BandHas"/>.</summary>
    public bool SurvivesErosion(int cx, int cy) =>
        Hash(cx, cy, _seed ^ SaltRot) % 1024 >= Erosion * 1024;

    /// <summary>
    /// How far band <paramref name="b"/>'s road has strayed from its centre line at position
    /// <paramref name="t"/> along its length, as a whole number of cells in [-Amp, +Amp].
    /// </summary>
    /// <remarks>
    /// Salted by the band, or every road in the yard would wind in perfect unison - which looks
    /// less like a road network than the straight lattice it replaced did.
    /// </remarks>
    private int Wander(int b, int t, int salt)
    {
        int s = _seed ^ salt ^ unchecked(b * unchecked((int)0x9e3779b1));
        double n = VNoise(t, WaveLong, s) * WaveMix
                 + VNoise(t, WaveShort, s ^ 0x5bf03635) * (1 - WaveMix);
        // JavaScript's Math.round, not C#'s - halves go UP rather than to even. Every disagreement
        // between the two is a road sitting in a different column. See JsMath.Round.
        return (int)JsMath.Round((n * 2 - 1) * Amp);
    }

    /// <summary>The centreline straight off the noise, before spikes are taken out of it.</summary>
    private int Raw(int b, int t, int salt) => b * Band + (Band >> 1) + Wander(b, t, salt);

    /// <summary>
    /// The column band <paramref name="b"/>'s vertical road occupies at row <paramref name="cy"/>,
    /// or <see cref="NoRoad"/> if the band has none.
    /// </summary>
    /// <remarks>
    /// <para>
    /// The road never leaves its band - centre line at Band/2, swing capped at Amp - which is why
    /// this can answer by looking at one band instead of searching neighbours.
    /// </para>
    /// <para>
    /// A ONE-ROW SPIKE IS FLATTENED, and that is not smoothing for its own sake: it is the one
    /// shape this tile set cannot draw. A road that steps one cell sideways and immediately back
    /// covers a 2x2 square of cells, and a 2x2 of corner tiles is a closed RING with a hole in the
    /// middle - a tiny roundabout somebody built in the middle of nowhere. Flattening the spike is
    /// the fix rather than deleting one of the four cells, because every choice of which cell to
    /// delete disconnects the road in some other configuration.
    /// </para>
    /// </remarks>
    private int ColAt(int b, int cy)
    {
        if (!BandHas(b, 0)) return NoRoad;
        long key = (long)b * 0x100000 + cy + 0x80000;
        if (_colMemo.TryGetValue(key, out int seen)) return seen;
        int here = Raw(b, cy, SaltCol);
        int before = Raw(b, cy - 1, SaltCol);
        int after = Raw(b, cy + 1, SaltCol);
        int result = before == after && before != here ? before : here;
        _colMemo[key] = result;
        return result;
    }

    private int RowAt(int b, int cx)
    {
        if (!BandHas(b, 1)) return NoRoad;
        long key = (long)b * 0x100000 + cx + 0x80000;
        if (_rowMemo.TryGetValue(key, out int seen)) return seen;
        int here = Raw(b, cx, SaltRow);
        int before = Raw(b, cx - 1, SaltRow);
        int after = Raw(b, cx + 1, SaltRow);
        int result = before == after && before != here ? before : here;
        _rowMemo[key] = result;
        return result;
    }

    /// <summary>
    /// Whether this cell is on a vertical road.
    /// </summary>
    /// <remarks>
    /// THE SPAN IS WHAT KEEPS A WINDING ROAD CONNECTED, and it is the whole trick. Row
    /// <paramref name="cy"/> holds not just the road's column at <paramref name="cy"/> but every
    /// cell between that and its column at <c>cy + 1</c>. So when the road moves sideways it lays
    /// the corner and the horizontal run it needs on the way, and the cell it lands on is by
    /// construction also the start of the next row's span. Neither cell consults the other and
    /// neither has to be visited first; both derive the same two columns from the same noise and
    /// agree about the run between them.
    /// </remarks>
    private bool VertAt(int cx, int cy)
    {
        int b = FloorDiv(cx, Band);
        int here = ColAt(b, cy);
        if (here == NoRoad) return false;
        int next = ColAt(b, cy + 1);
        return cx >= System.Math.Min(here, next) && cx <= System.Math.Max(here, next);
    }

    private bool HorizAt(int cx, int cy)
    {
        int b = FloorDiv(cy, Band);
        int here = RowAt(b, cx);
        if (here == NoRoad) return false;
        int next = RowAt(b, cx + 1);
        return cy >= System.Math.Min(here, next) && cy <= System.Math.Max(here, next);
    }

    /// <summary>
    /// The one question the whole layer is built out of. Called for the cell AND for its four
    /// neighbours, so it has to be cheap and it has to be consistent - the mask is only correct
    /// because a neighbour asked about from either side answers the same way.
    /// </summary>
    public bool Road(int cx, int cy)
    {
        bool vert = VertAt(cx, cy);
        bool horiz = HorizAt(cx, cy);
        if (!vert && !horiz) return false;
        // A CROSSING NEVER ROTS. Erosion is allowed to break a road anywhere along its length, but
        // a junction is the one piece of this layer that is actually load-bearing: it is the
        // landmark the roads exist to provide, and "the crossroads north of where I died" stops
        // meaning anything if the crossroads is a coin flip. It also keeps the 15-tile drawn.
        if (vert && horiz) return true;
        return SurvivesErosion(cx, cy);
    }

    /// <summary>
    /// The connectivity mask for a cell: 1 = north, 2 = east, 4 = south, 8 = west.
    /// </summary>
    /// <remarks>
    /// NO ROTATION ANYWHERE IN THIS LAYER. The fifteen tiles are a complete connectivity set - four
    /// end caps, two straights, four corners, four T-junctions and a crossroads - each drawn
    /// upright with its path meeting the tile edge at the MIDPOINT, measured rather than assumed.
    /// The asset step names them BY THIS MASK, so the lookup is one array index and there is no
    /// table here to fall out of step with the art.
    /// </remarks>
    public int Mask(int cx, int cy)
    {
        // THE CENTRE CELL FIRST. Leaving this out is not a subtle mistranslation, it is a whole
        // extra road: every bare cell beside a road has a road neighbour, so it masks non-zero and
        // draws a tile, and the network comes out two cells wide everywhere with a fringe around
        // the junctions. The original asks this in its draw loop and the split moved it here, which
        // is exactly the kind of thing that gets dropped in the move - the fixture caught it on the
        // first run.
        if (!Road(cx, cy)) return 0;

        int mask = 0;
        if (Road(cx, cy - 1)) mask |= 1;
        if (Road(cx + 1, cy)) mask |= 2;
        if (Road(cx, cy + 1)) mask |= 4;
        if (Road(cx - 1, cy)) mask |= 8;
        return mask;
    }

    /// <summary>The alpha one cell is drawn at, after its own wear roll.</summary>
    public double WearAlpha(int cx, int cy)
    {
        uint wear = (Hash(cx, cy, _seed ^ SaltWear) >> 8) & 0xff;
        return System.Math.Min(1, Alpha * (WearMin + (wear / (double)0xff) * (WearMax - WearMin)));
    }
}
