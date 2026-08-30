using System.Collections.Generic;

namespace Scrapyard.Core;

/// <summary>
/// CITY CHAOS'S STREETS: an UNBOUNDED road grid, with a city block filling every square between.
/// Port of <c>content/wallsCity.ts</c>.
/// </summary>
/// <remarks>
/// <para>
/// <b>NOT MOSSY'S LATTICE WITH DIFFERENT SPRITES.</b> Mossy deals at most one free-standing shape
/// per block, inset so neighbours never touch. A city is the opposite promise: the terrain IS the
/// joins - roads run forever on both axes and every block face sits flush against its street. None
/// of <see cref="MossWalls"/>'s one-shape machinery applies, and the two files share a philosophy
/// and zero symbols, exactly as their TypeScript originals do.
/// </para>
/// <para>
/// <b>NO CACHE, UNLIKE MOSSY.</b> What is standing in cell (x, y) is a pure function of (seed,
/// block coordinates) - a hash plus a membership test, roughly a dozen integer ops - so there is
/// no generated array to memoize and no <c>Dictionary</c>/eviction-queue pair here at all.
/// </para>
/// <para>
/// <b>THE SAME <c>long</c>-KEYED PACKING AS <see cref="MossWalls"/>, FOR THE SAME REASON.</b>
/// <c>KeyBias</c>/<c>KeySpan</c> are numerically identical to Mossy's, and the packed cell key
/// overflows <c>int32</c> for every real cell exactly as Mossy's does (the TypeScript's plain
/// <c>number</c> is exact up to 2^53 and never notices). Widened to <c>long</c> from the first
/// draft this time rather than caught by a fixture the way Mossy's was.
/// </para>
/// <para>
/// <b>A DRUM WHERE MOSSY HAS SHEEP.</b> The city's loot prop is the Scrapyard's own fuel barrel: a
/// cell, not an entity, so it needs no pool, no upkeep tick and no cull radius - the grid is a pure
/// function of the seed either way. Its collider is a smaller inset box than the cell it stands in
/// (see <see cref="CellHalf"/>), which is the one place a "cell" query in this file has to know
/// there are two sizes of thing standing in the lattice.
/// </para>
/// <para>
/// <b>MODULE-SCRATCH RETURN VALUES BECOME VALUE RETURNS HERE</b>, for the same reason recorded on
/// <see cref="MossWalls"/>: nothing here holds a shared mutable scratch object across a call, so
/// <see cref="SceneryPush"/> and the ray-hit cell are ordinary returns / <c>out</c> parameters.
/// </para>
/// </remarks>
public sealed class CityBlocks : IScenery
{
    // -----------------------------------------------------------------------------------------
    // Constants
    // -----------------------------------------------------------------------------------------

    /// <summary>Edge of one lattice cell, world units. Same figure Mossy landed on, same reason.</summary>
    public const int CityCell = 64;

    /// <summary>Cells from one road's left edge to the next - the period of the whole city.</summary>
    public const int CityPeriod = 10;

    /// <summary>Cells of road between blocks.</summary>
    public const int CityRoadCells = 2;

    /// <summary>Cells along one edge of a block interior.</summary>
    public const int CityBlockCells = CityPeriod - CityRoadCells;

    /// <summary>How many cells the grid is shifted so the origin lands mid-crossroads.</summary>
    private const int CityPhase = 1;

    /// <summary>What a cell holds.</summary>
    public const int CityEmpty = 0;

    /// <summary>Building mass. Permanent - nothing in the game breaks a building.</summary>
    public const int CityBuilding = 1;

    /// <summary>Construction-site fencing or a material pile. Breakable; leaves rubble.</summary>
    public const int CityFence = 2;

    /// <summary>A fuel drum. Breakable, and the only thing on this map that pays out loot.</summary>
    public const int CityBarrel = 3;

    /// <summary>Hit points of one fence cell, split into two visible sections.</summary>
    public const int FenceSectionHp = 90;

    public const int FenceSections = 2;

    /// <summary>Half-extent of a drum's collider, world units - NOT half a cell. See <see cref="CellHalf"/>.</summary>
    public const double CityBarrelHalf = 20;

    /// <summary>Share of a block's OPEN cells that hold a drum. Derived from the other two maps' loot density.</summary>
    private const double CityBarrelShare = 0.007;

    private const int BlockFilled = 0;
    private const int BlockConstruction = 1;
    private const int BlockCourtyard = 2;
    private const int BlockPlaza = 3;

    private static readonly double[] BlockCdf = { 0.34, 0.64, 0.84, 1.0 };

    /// <summary>Packing bias for global cell keys - same scheme as Mossy's.</summary>
    private const int KeyBias = 1 << 20;

    private const int KeySpan = 1 << 21;

    // Question indices for BlockFrac/BlockInt - named so no two rolls collide by accident.
    private const int QType = 0;
    private const int QShape = 1;
    private const int QGateSide = 2;
    private const int QGateAlong = 3;
    private const int QGate2 = 4;
    private const int QGate2Side = 5;
    private const int QGate2Along = 6;
    private const int QScatter = 7; // ..and the ten after it, two per possible pile.
    /// <summary>Which silhouette a site's hoarding takes, and which way round it faces.</summary>
    private const int QSite = 17;
    private const int QSiteRot = 18;
    private const int QBarrel = 24;

    private const int ScatterMin = 3;
    private const int ScatterSpan = 3;

    /// <summary>
    /// Which sides of its block a construction site fences off - the city's answer to Mossy's
    /// SHAPE_CDF. See the TypeScript for why this is a SIDE MASK rather than a shape stamper: a
    /// block is eight cells across and its wall ring is one cell thick, so what varies is which of
    /// the four runs get built, not where a free shape lands.
    /// </summary>
    /// <remarks>
    /// Hoarding is all four sides and is entered through a cut gateway; open is three, and the
    /// missing run IS the way in; ell is two adjacent runs meeting at a corner; lane is two
    /// opposite runs with open ends. A corner cell is built if EITHER of its runs is, which is
    /// what keeps an ell turning a corner instead of coming apart into two loose lines.
    /// </remarks>
    private const int SiteHoarding = 0;
    private const int SiteOpen = 1;
    private const int SiteEll = 2;

    private static readonly double[] SiteCdf = { 0.4, 0.66, 0.86, 1.0 };

    /// <summary>Side bits, in the same order <see cref="InGateway"/> numbers its sides.</summary>
    private const int SideTop = 1;
    private const int SideBottom = 2;
    private const int SideLeft = 4;
    private const int SideRight = 8;
    private const int SidesAll = SideTop | SideBottom | SideLeft | SideRight;

    private static readonly int[] EllPairs =
    {
        SideTop | SideLeft, SideTop | SideRight, SideBottom | SideLeft, SideBottom | SideRight,
    };

    /// <summary>Which runs of its ring this construction site builds.</summary>
    private static int SiteSides(int h)
    {
        double roll = BlockFrac(h, QSite);
        int kind = SiteCdf.Length - 1;
        for (int i = 0; i < SiteCdf.Length; i++)
        {
            if (roll < SiteCdf[i]) { kind = i; break; }
        }
        if (kind == SiteHoarding) return SidesAll;

        int r = BlockInt(h, QSiteRot, 4);
        if (kind == SiteOpen) return SidesAll & ~(1 << r);
        if (kind == SiteEll) return EllPairs[r];
        return r < 2 ? SideTop | SideBottom : SideLeft | SideRight;
    }

    /// <summary>Which of the four runs a ring cell sits on - two of them, on a corner.</summary>
    private static int RingSides(int thick, int lx, int ly)
    {
        int n = CityBlockCells;
        int m = 0;
        if (ly <= thick) m |= SideTop;
        if (ly >= n - 1 - thick) m |= SideBottom;
        if (lx <= thick) m |= SideLeft;
        if (lx >= n - 1 - thick) m |= SideRight;
        return m;
    }

    /// <summary>Width of every gateway, cells.</summary>
    private const int GateWidth = 2;

    /// <summary>
    /// How many cells thick a ring block's wall is - the same for construction sites and
    /// courtyards. LIVE ARITHMETIC, not a hand-folded literal: the TypeScript source is explicit
    /// that this is a safety-net clamp rather than a fixed number, so a future retune of
    /// <see cref="CityBlockCells"/> or <see cref="GateWidth"/> must move it rather than silently
    /// go stale. <see cref="InGateway"/> derives its own range from this same field.
    /// </summary>
    private static readonly int RingThickness =
        System.Math.Min(1, (int)System.Math.Floor((CityBlockCells - GateWidth - 1) / 2.0));

    /// <summary>The same number, for the renderer.</summary>
    public static readonly int CityRingThickness = RingThickness;

    /// <summary>Half a cell: the radius a cell reports (for non-drum kinds), and the burst size.</summary>
    public const double CityHalf = CityCell / 2.0;

    /// <summary>How many resolution passes a push may take. See wallsMossy's PUSH_PASSES - measured
    /// there, and reused here unchanged because the geometry is the same lattice.</summary>
    private const int PushPasses = 3;

    // -----------------------------------------------------------------------------------------
    // State
    // -----------------------------------------------------------------------------------------

    /// <summary>The run seed. The whole city is a pure function of this.</summary>
    public readonly int Seed;

    /// <summary>Global cells whose fence/drum has been broken, keyed by <see cref="CellKeyOf"/>. Never evicted.</summary>
    private readonly HashSet<long> _broken = new();

    /// <summary>Damage taken by fence cells that are hurt and not yet down, keyed by global cell.</summary>
    private readonly Dictionary<long, double> _hurt = new();

    public int Count { get; private set; }

    public int Version { get; private set; }

    public CityBlocks(int seed)
    {
        Seed = unchecked(seed | 0);
    }

    // -----------------------------------------------------------------------------------------
    // Keys
    // -----------------------------------------------------------------------------------------

    private static long CellKeyOf(int cx, int cy) => (long)(cx + KeyBias) * KeySpan + (cy + KeyBias);

    /// <summary>Cell index packing for the <see cref="IScenery"/> query contract.</summary>
    public static long PackCityCell(int cx, int cy) => CellKeyOf(cx, cy);

    public static int CityCellX(long i) => (int)System.Math.Floor((double)i / KeySpan) - KeyBias;

    public static int CityCellY(long i)
    {
        // JS `%` is a REMAINDER (sign follows the dividend); `long % int` in C# agrees, exactly as
        // documented on MossWalls.WallCellY.
        return (int)(i % KeySpan) - KeyBias;
    }

    // -----------------------------------------------------------------------------------------
    // The grid arithmetic
    // -----------------------------------------------------------------------------------------

    /// <summary>Floor division, correct for the negative half of the plane.</summary>
    private static int FloorDiv(int a, int b) => (int)System.Math.Floor((double)a / b);

    /// <summary>Non-negative modulo, same caveat.</summary>
    private static int Mod(int a, int b)
    {
        int m = a % b;
        return m < 0 ? m + b : m;
    }

    /// <summary>Cell column containing a world x (also the row for a world y - the lattice is square).</summary>
    public static int CityCellOf(double v) => (int)System.Math.Floor(v / CityCell);

    /// <summary>Centre of a cell, per axis.</summary>
    public static double CityCentre(int c) => (c + 0.5) * CityCell;

    /// <summary>Local position of a cell within its period: 0..RoadCells-1 is road, above is the block interior.</summary>
    private static int LocalOf(int c) => Mod(c + CityPhase, CityPeriod);

    /// <summary>True when this cell is street on this axis.</summary>
    public static bool CityIsRoadCell(int c) => LocalOf(c) < CityRoadCells;

    /// <summary>True when the cell is road on either axis.</summary>
    public static bool CityIsRoad(int cx, int cy) => CityIsRoadCell(cx) || CityIsRoadCell(cy);

    /// <summary>Which block a non-road cell belongs to, per axis.</summary>
    private static int BlockIndexOf(int c) => FloorDiv(c + CityPhase, CityPeriod);

    // -----------------------------------------------------------------------------------------
    // Hashing
    // -----------------------------------------------------------------------------------------

    /// <summary>A 32-bit hash of one block and the seed. Same three-round construction Mossy uses.</summary>
    private static int HashBlock(int seed, int bx, int by)
    {
        int h = seed;
        h = unchecked((h ^ bx) * unchecked((int)0x27d4eb2f));
        h = unchecked((h ^ by) * unchecked((int)0x85ebca6b));
        h ^= h >>> 15;
        h = unchecked(h * unchecked((int)0xc2b2ae35));
        h ^= h >>> 13;
        return h;
    }

    /// <summary>A stable 0..1 for question <paramref name="q"/> about one block, re-mixed from its hash.</summary>
    private static double BlockFrac(int h, int q)
    {
        int v = unchecked((h ^ unchecked((q + 1) * unchecked((int)0x9e3779b1))) * unchecked((int)0xc2b2ae35));
        v ^= v >>> 16;
        v = unchecked(v * unchecked((int)0x27d4eb2f));
        return (uint)(v ^ (v >>> 15)) / 4294967296.0;
    }

    /// <summary>A stable 0..1 for question <paramref name="q"/> about ONE CELL of a block.</summary>
    private static double CellFrac(int h, int lx, int ly, int q)
    {
        int v = unchecked((h ^ unchecked((lx + 1) * unchecked((int)0x2545f491))) * unchecked((int)0x9e3779b1));
        v = unchecked((v ^ unchecked((ly + 1) * unchecked((int)0x85ebca6b))) * unchecked((int)0xc2b2ae35));
        v ^= unchecked((q + 1) * unchecked((int)0x27d4eb2f));
        v ^= v >>> 15;
        v = unchecked(v * unchecked((int)0x2c1b3c6d));
        return (uint)(v ^ (v >>> 13)) / 4294967296.0;
    }

    /// <summary>A stable integer in [0, n) for question <paramref name="q"/>.</summary>
    private static int BlockInt(int h, int q, int n)
    {
        int v = (int)System.Math.Floor(BlockFrac(h, q) * n);
        return v >= n ? n - 1 : v;
    }

    // -----------------------------------------------------------------------------------------
    // What is standing in a block
    // -----------------------------------------------------------------------------------------

    /// <summary>Which of the four layouts a block deals, from its hash.</summary>
    private static int BlockTypeOf(int h)
    {
        double roll = BlockFrac(h, QType);
        for (int i = 0; i < BlockCdf.Length; i++)
        {
            if (roll < BlockCdf[i]) return i;
        }
        return BlockPlaza;
    }

    /// <summary>
    /// The block's own layout in local cell (lx, ly), 0..CityBlockCells-1 on both axes, before
    /// drums are scattered over what it left open. Pure in (hash of block, lx, ly).
    /// </summary>
    private static int BlockCellBase(int h, int lx, int ly)
    {
        int n = CityBlockCells;
        // Ring 0 is pavement on every block type - structures start one cell in.
        int ring = System.Math.Min(System.Math.Min(lx, ly), System.Math.Min(n - 1 - lx, n - 1 - ly));
        if (ring == 0) return CityEmpty;

        int type = BlockTypeOf(h);

        if (type == BlockPlaza) return CityEmpty;

        if (type == BlockFilled)
        {
            // The mass spans rings 1+ (a 6x6 slab). Three silhouettes, dealt by one roll.
            int shape = BlockInt(h, QShape, 3);
            if (shape == 1)
            {
                // The L: the full slab minus one quadrant.
                int corner = BlockInt(h, QGate2, 4);
                int half = n / 2;
                bool inBiteX = corner % 2 == 0 ? lx < half : lx >= half;
                bool inBiteY = corner < 2 ? ly < half : ly >= half;
                if (inBiteX && inBiteY) return CityEmpty;
            }
            else if (shape == 2)
            {
                // Twin slabs: the two middle rows/columns are an alley.
                bool vertical = BlockFrac(h, QGate2Side) < 0.5;
                int along = vertical ? lx : ly;
                int mid = n / 2;
                if (along == mid - 1 || along == mid) return CityEmpty;
            }
            return CityBuilding;
        }

        // Both remaining types are a ring with gateways, one cell thick, cut by a gap that goes
        // all the way through.
        int thick = RingThickness;
        bool onRing = ring >= 1 && ring <= thick;

        if (onRing)
        {
            // A courtyard is ALWAYS the complete ring with exactly one way in - the silhouettes in
            // SiteCdf are a construction site's, and a courtyard opened up on two sides is a plaza
            // with extra steps.
            if (type == BlockCourtyard)
            {
                if (InGateway(h, QGateSide, QGateAlong, thick, lx, ly)) return CityEmpty;
                return CityBuilding;
            }

            int sides = SiteSides(h);
            if ((RingSides(thick, lx, ly) & sides) == 0) return CityEmpty;

            // Gateways only where there is something to cut through: a site missing a whole run is
            // already open, and a second door through a three-sided hoarding reads as a fence that
            // fell down rather than as a site with a gate.
            if (sides == SidesAll)
            {
                if (InGateway(h, QGateSide, QGateAlong, thick, lx, ly)) return CityEmpty;
                if (BlockFrac(h, QGate2) < 0.5 &&
                    InGateway(h, QGate2Side, QGate2Along, thick, lx, ly))
                {
                    return CityEmpty;
                }
            }
            return CityFence;
        }

        // Inside a construction site: a few material piles, at hashed cells strictly inside the
        // fence, except in a gateway's own aisle at any depth.
        if (type == BlockConstruction && ring > thick)
        {
            // Only a SEALED site has an aisle to keep clear: a site with a whole run missing has
            // no gap to block, so reserving a lane through it would protect a doorway that is not
            // there and cost the site two cells of scatter for nothing.
            bool isSealed = SiteSides(h) == SidesAll;
            bool secondGate = BlockFrac(h, QGate2) < 0.5;
            bool inAisle =
                isSealed &&
                (InGatewayLane(h, QGateSide, QGateAlong, thick, lx, ly) ||
                 (secondGate && InGatewayLane(h, QGate2Side, QGate2Along, thick, lx, ly)));
            if (!inAisle)
            {
                int piles = ScatterMin + BlockInt(h, QScatter, ScatterSpan);
                int lo = thick + 1;
                int span = n - 2 * lo;
                for (int k = 0; k < piles; k++)
                {
                    int px = lo + BlockInt(h, QScatter + 1 + k * 2, span);
                    int py = lo + BlockInt(h, QScatter + 2 + k * 2, span);
                    if (px == lx && py == ly) return CityFence;
                }
            }
        }
        return CityEmpty;
    }

    /// <summary>
    /// What the block puts in local cell (lx, ly): the layout, plus any drum standing on it. A
    /// drum refuses the block's own (0, 0) pavement corner and both gateway lanes.
    /// </summary>
    private static int BlockCellKind(int h, int lx, int ly)
    {
        int baseKind = BlockCellBase(h, lx, ly);
        if (baseKind != CityEmpty) return baseKind;
        if (lx == 0 && ly == 0) return CityEmpty;
        int thick = RingThickness;
        if (InGatewayLane(h, QGateSide, QGateAlong, thick, lx, ly)) return CityEmpty;
        if (BlockFrac(h, QGate2) < 0.5 && InGatewayLane(h, QGate2Side, QGate2Along, thick, lx, ly))
        {
            return CityEmpty;
        }
        return CellFrac(h, lx, ly, QBarrel) < CityBarrelShare ? CityBarrel : CityEmpty;
    }

    /// <summary>
    /// Is local cell (lx, ly) inside the gateway named by questions (qSide, qAlong)? The band's
    /// range is constrained to lanes that are genuinely interior to the ring - see
    /// <see cref="InGatewayLane"/> - which is the fix for a historical bug: a flatter range used to
    /// let the gap land near a corner of a thick ring and notch into the wall without opening it,
    /// producing a courtyard with no working door on about a quarter of them.
    /// </summary>
    private static bool InGateway(int h, int qSide, int qAlong, int thick, int lx, int ly)
    {
        int n = CityBlockCells;
        int side = BlockInt(h, qSide, 4);
        // Depth is the ring's own thickness: the cut goes through the wall and no further.
        bool throughWall = side == 0 ? ly <= thick
            : side == 1 ? ly >= n - 1 - thick
            : side == 2 ? lx <= thick
            : lx >= n - 1 - thick;
        return throughWall && InGatewayLane(h, qSide, qAlong, thick, lx, ly);
    }

    /// <summary>
    /// The gateway's LANE, at any depth into the block - the two-cell aisle running straight in
    /// from the gap. Shared between <see cref="InGateway"/> and the pile scatter so a pile can
    /// never dealt into the one path leading to the door.
    /// </summary>
    private static bool InGatewayLane(int h, int qSide, int qAlong, int thick, int lx, int ly)
    {
        int n = CityBlockCells;
        int side = BlockInt(h, qSide, 4);
        int lo = thick + 1;
        // The last start position whose whole band still lands on interior lanes.
        int span = n - 1 - thick - GateWidth - lo + 1;
        int along = lo + BlockInt(h, qAlong, System.Math.Max(1, span));
        int across = side == 0 || side == 1 ? lx : ly;
        return across >= along && across < along + GateWidth;
    }

    // -----------------------------------------------------------------------------------------
    // The queries the Scenery contract dispatches to, plus the renderer's own
    // -----------------------------------------------------------------------------------------

    /// <summary>
    /// True when (cx, cy) sits on a block's wall ring - a fence cell ON the ring is a run of site
    /// barrier; the same kind deeper in is a free-standing material pile. For the dressing.
    /// </summary>
    public static bool CityFenceRing(int cx, int cy)
    {
        if (CityIsRoad(cx, cy)) return false;
        int lx = LocalOf(cx) - CityRoadCells;
        int ly = LocalOf(cy) - CityRoadCells;
        int n = CityBlockCells;
        int ring = System.Math.Min(System.Math.Min(lx, ly), System.Math.Min(n - 1 - lx, n - 1 - ly));
        return ring >= 1 && ring <= RingThickness;
    }

    /// <summary>
    /// True when (cx, cy) lies in a block that dealt CONSTRUCTION - roads excluded. For the
    /// dressing, which scatters site litter over exactly these blocks. Pure in (seed, cx, cy), so -
    /// like <see cref="MossWalls.WallStemsAt"/> - it takes the seed directly rather than an
    /// instance.
    /// </summary>
    public static bool CityIsConstructionBlock(int seed, int cx, int cy)
    {
        if (CityIsRoad(cx, cy)) return false;
        return BlockTypeOf(HashBlock(seed, BlockIndexOf(cx), BlockIndexOf(cy))) == BlockConstruction;
    }

    /// <summary>What is in cell (cx, cy), with the broken set applied - the one world every query sees.</summary>
    public int CityKindAt(int cx, int cy)
    {
        if (CityIsRoad(cx, cy)) return CityEmpty;
        int bx = BlockIndexOf(cx);
        int by = BlockIndexOf(cy);
        int lx = LocalOf(cx) - CityRoadCells;
        int ly = LocalOf(cy) - CityRoadCells;
        int kind = BlockCellKind(HashBlock(Seed, bx, by), lx, ly);
        // Both breakables consult it - a drum that stayed in the grid after it went up would be an
        // invisible collider standing in the street forever, and would re-pay its loot on touch.
        if ((kind == CityFence || kind == CityBarrel) && _broken.Contains(CellKeyOf(cx, cy)))
        {
            return CityEmpty;
        }
        return kind;
    }

    /// <summary>
    /// What would be in cell (cx, cy) if nothing had ever been broken - the generated terrain,
    /// before the broken set is applied. NOT FOR THE SIMULATION: only the dressing needs this, to
    /// tell a felled fence's rubble apart from a shot drum's scorch mark once both read CityEmpty.
    /// Pure in (seed, cx, cy), so - like <see cref="CityIsConstructionBlock"/> - it takes the seed
    /// directly.
    /// </summary>
    public static int CityPristineKindAt(int seed, int cx, int cy)
    {
        if (CityIsRoad(cx, cy)) return CityEmpty;
        int lx = LocalOf(cx) - CityRoadCells;
        int ly = LocalOf(cy) - CityRoadCells;
        return BlockCellKind(HashBlock(seed, BlockIndexOf(cx), BlockIndexOf(cy)), lx, ly);
    }

    /// <summary>True if this cell held fencing/a drum that has since been broken.</summary>
    public bool IsCityBroken(int cx, int cy) => _broken.Contains(CellKeyOf(cx, cy));

    /// <summary>True when a standing drum occupies this cell.</summary>
    public bool CityIsBarrel(int cx, int cy) => CityKindAt(cx, cy) == CityBarrel;

    /// <summary>
    /// The half-extent of a cell's collider. A wall or fence fills its cell; a DRUM does not - see
    /// <see cref="CityBarrelHalf"/>. One function because every query below has to agree: a barrel
    /// that stopped shells at one size and the mech at another is the kind of mismatch nobody sees
    /// until they are standing next to it.
    /// </summary>
    private static double CellHalf(int kind) => kind == CityBarrel ? CityBarrelHalf : CityHalf;

    /// <summary>Squared distance from (x, y) to the nearest point of cell (cx, cy); 0 when inside it.</summary>
    private static double CellDist2(int cx, int cy, double x, double y, double half)
    {
        double mx = CityCentre(cx);
        double my = CityCentre(cy);
        double dx = System.Math.Abs(x - mx) - half;
        double dy = System.Math.Abs(y - my) - half;
        double ex = dx > 0 ? dx : 0;
        double ey = dy > 0 ? dy : 0;
        return ex * ex + ey * ey;
    }

    /// <summary>
    /// The first standing cell the circle (x, y, r) touches, or -1. <c>d2 == 0</c> IS a hit - a
    /// point exactly on a box edge must still stop a projectile, or every round in the game flies
    /// through every wall.
    /// </summary>
    public long Overlap(double x, double y, double r)
    {
        int c0 = CityCellOf(x - r);
        int c1 = CityCellOf(x + r);
        int r0 = CityCellOf(y - r);
        int r1 = CityCellOf(y + r);
        for (int cy = r0; cy <= r1; cy++)
        {
            for (int cx = c0; cx <= c1; cx++)
            {
                int kind = CityKindAt(cx, cy);
                if (kind == CityEmpty) continue;
                double d2 = CellDist2(cx, cy, x, y, CellHalf(kind));
                if (d2 == 0 || d2 < r * r) return PackCityCell(cx, cy);
            }
        }
        return -1;
    }

    /// <summary>The nearest BREAKABLE cell the circle touches, or -1. Both fence and drum count.</summary>
    public long DestructibleOverlap(double x, double y, double r)
    {
        int c0 = CityCellOf(x - r);
        int c1 = CityCellOf(x + r);
        int r0 = CityCellOf(y - r);
        int r1 = CityCellOf(y + r);
        long best = -1;
        double bestD2 = 0;
        for (int cy = r0; cy <= r1; cy++)
        {
            for (int cx = c0; cx <= c1; cx++)
            {
                int kind = CityKindAt(cx, cy);
                if (kind != CityFence && kind != CityBarrel) continue;
                double d2 = CellDist2(cx, cy, x, y, CellHalf(kind));
                if (d2 != 0 && d2 >= r * r) continue;
                if (best < 0 || d2 < bestD2)
                {
                    best = PackCityCell(cx, cy);
                    bestD2 = d2;
                }
            }
        }
        return best;
    }

    public bool IsDestructible(long i)
    {
        int kind = CityKindAt(CityCellX(i), CityCellY(i));
        return kind == CityFence || kind == CityBarrel;
    }

    // -----------------------------------------------------------------------------------------
    // Push-out
    // -----------------------------------------------------------------------------------------

    /// <summary>
    /// Slides a circle out of whatever it has entered. Same corner-exact, open-face-aware routine
    /// <see cref="MossWalls.PushOut"/> uses, documented there in full - a box lattice is a box
    /// lattice regardless of which cell sizes it mixes.
    /// </summary>
    public SceneryPush PushOut(double x, double y, double r)
    {
        var push = new SceneryPush { X = x, Y = y, Nx = 0, Ny = 0, Hit = false };

        for (int pass = 0; pass < PushPasses; pass++)
        {
            double px = push.X;
            double py = push.Y;
            int c0 = CityCellOf(px - r);
            int c1 = CityCellOf(px + r);
            int r0 = CityCellOf(py - r);
            int r1 = CityCellOf(py + r);

            int bestCx = 0;
            int bestCy = 0;
            double bestD2 = r * r;
            double bestHalf = CityHalf;
            bool found = false;
            for (int cy = r0; cy <= r1; cy++)
            {
                for (int cx = c0; cx <= c1; cx++)
                {
                    int kind = CityKindAt(cx, cy);
                    if (kind == CityEmpty) continue;
                    double half = CellHalf(kind);
                    double d2 = CellDist2(cx, cy, px, py, half);
                    if (d2 >= bestD2) continue;
                    bestD2 = d2;
                    bestCx = cx;
                    bestCy = cy;
                    bestHalf = half;
                    found = true;
                }
            }
            if (!found) break;

            // The collider's own box - inset for a drum, per CellHalf - so everything below is
            // written against these four numbers with no special case for which kind it is.
            double mx = CityCentre(bestCx);
            double my = CityCentre(bestCy);
            double x0 = mx - bestHalf;
            double y0 = my - bestHalf;
            double x1 = mx + bestHalf;
            double y1 = my + bestHalf;

            if (bestD2 > 0)
            {
                double qx = px < x0 ? x0 : px > x1 ? x1 : px;
                double qy = py < y0 ? y0 : py > y1 ? y1 : py;
                double dx = px - qx;
                double dy = py - qy;
                double inv = 1 / System.Math.Sqrt(dx * dx + dy * dy);
                push.Nx = dx * inv;
                push.Ny = dy * inv;
                push.X = qx + push.Nx * r;
                push.Y = qy + push.Ny * r;
            }
            else
            {
                double dl = px - x0;
                double dr = x1 - px;
                double du = py - y0;
                double dd = y1 - py;
                bool openL = CityKindAt(bestCx - 1, bestCy) == CityEmpty;
                bool openR = CityKindAt(bestCx + 1, bestCy) == CityEmpty;
                bool openU = CityKindAt(bestCx, bestCy - 1) == CityEmpty;
                bool openD = CityKindAt(bestCx, bestCy + 1) == CityEmpty;
                bool any = openL || openR || openU || openD;
                double cl = !any || openL ? dl : double.PositiveInfinity;
                double cr = !any || openR ? dr : double.PositiveInfinity;
                double cu = !any || openU ? du : double.PositiveInfinity;
                double cd = !any || openD ? dd : double.PositiveInfinity;
                double m = System.Math.Min(System.Math.Min(cl, cr), System.Math.Min(cu, cd));
                if (m == cl) { push.Nx = -1; push.Ny = 0; push.X = x0 - r; push.Y = py; }
                else if (m == cr) { push.Nx = 1; push.Ny = 0; push.X = x1 + r; push.Y = py; }
                else if (m == cu) { push.Nx = 0; push.Ny = -1; push.X = px; push.Y = y0 - r; }
                else { push.Nx = 0; push.Ny = 1; push.X = px; push.Y = y1 + r; }
            }
            push.Hit = true;
        }

        return push;
    }

    // -----------------------------------------------------------------------------------------
    // Raycasting
    // -----------------------------------------------------------------------------------------

    /// <summary>
    /// DDA over the lattice: distance at which the ray first enters a cell whose kind is
    /// <paramref name="want"/> or <paramref name="want2"/> (pass -1 to disable the second), or -1
    /// within <paramref name="maxT"/>. <paramref name="want2"/> exists for the destructibles: a
    /// beam stopped by a fence AND a drum, walked as one pass rather than two, so a fence beyond a
    /// barrel cannot win a race the single-kind version would lose.
    /// </summary>
    private double RayWalk(double ox, double oy, double dx, double dy, double maxT, int want, int want2,
                            out int hitCx, out int hitCy)
    {
        int cx = CityCellOf(ox);
        int cy = CityCellOf(oy);

        bool Wanted(int k) => k == want || k == want2;

        if (Wanted(CityKindAt(cx, cy)))
        {
            hitCx = cx;
            hitCy = cy;
            return 0;
        }

        int stepX = dx > 0 ? 1 : -1;
        int stepY = dy > 0 ? 1 : -1;
        double tDeltaX = dx == 0 ? double.PositiveInfinity : CityCell / System.Math.Abs(dx);
        double tDeltaY = dy == 0 ? double.PositiveInfinity : CityCell / System.Math.Abs(dy);

        double nextX = (cx + (dx > 0 ? 1 : 0)) * (double)CityCell;
        double nextY = (cy + (dy > 0 ? 1 : 0)) * (double)CityCell;
        double tMaxX = dx == 0 ? double.PositiveInfinity : (nextX - ox) / dx;
        double tMaxY = dy == 0 ? double.PositiveInfinity : (nextY - oy) / dy;

        for (;;)
        {
            double t;
            if (tMaxX < tMaxY) { t = tMaxX; cx += stepX; tMaxX += tDeltaX; }
            else { t = tMaxY; cy += stepY; tMaxY += tDeltaY; }

            if (t > maxT) { hitCx = 0; hitCy = 0; return -1; }
            if (Wanted(CityKindAt(cx, cy)))
            {
                hitCx = cx;
                hitCy = cy;
                return t;
            }
        }
    }

    /// <summary>Distance at which the ray first meets BUILDING, or -1. Fences and drums are exempt.</summary>
    public double RayHit(double ox, double oy, double dx, double dy, double maxT) =>
        RayWalk(ox, oy, dx, dy, maxT, CityBuilding, -1, out _, out _);

    /// <summary>
    /// The first FENCE or DRUM the ray enters, packed, or -1 - the complement of <see cref="RayHit"/>.
    /// A beam can stop up to <c>CityHalf - CityBarrelHalf</c> short of a drum's paint, since this
    /// walks whole cells rather than clipping the inset box - invisible on a barrel about to go up
    /// anyway, and the alternative is a per-cell ray-box clip in the hot loop.
    /// </summary>
    public long DestructibleRayHit(double ox, double oy, double dx, double dy, double maxT, out double hitT)
    {
        double t = RayWalk(ox, oy, dx, dy, maxT, CityFence, CityBarrel, out int hitCx, out int hitCy);
        hitT = t;
        return t < 0 ? -1 : PackCityCell(hitCx, hitCy);
    }

    // -----------------------------------------------------------------------------------------
    // Fence and barrel damage
    // -----------------------------------------------------------------------------------------

    /// <summary>Breaks the fence/drum in a packed cell. One write; every query forgets it at once.</summary>
    public void Destroy(long i)
    {
        if (_broken.Contains(i)) return;
        _broken.Add(i);
        _hurt.Remove(i);
        Count++;
        Version++;
    }

    /// <summary>
    /// How many fence sections of a cell still stand: <see cref="FenceSections"/> untouched, 0 once
    /// broken, the remaining fraction rounded UP in between. A drum has no sections - it is whole
    /// or it is gone, so it never draws a dimmed half state.
    /// </summary>
    public int CitySectionsStanding(int cx, int cy)
    {
        long i = CellKeyOf(cx, cy);
        if (_broken.Contains(i)) return 0;
        if (CityKindAt(cx, cy) == CityBarrel) return FenceSections;
        if (!_hurt.TryGetValue(i, out double left)) return FenceSections;
        int up = (int)System.Math.Ceiling(left / FenceSectionHp);
        return up < 0 ? 0 : up > FenceSections ? FenceSections : up;
    }

    /// <summary>
    /// Puts damage into a fence/drum cell. Returns how many sections that hit brought down - 0 for
    /// most hits. A DRUM IGNORES <paramref name="amount"/>: it is a thing you set off, not grind
    /// down, so any damage that reaches it takes it and reports one "section" fired.
    /// </summary>
    public int Damage(long i, double amount)
    {
        if (amount <= 0 || _broken.Contains(i)) return 0;

        if (CityKindAt(CityCellX(i), CityCellY(i)) == CityBarrel)
        {
            Destroy(i);
            return 1;
        }

        double before = _hurt.TryGetValue(i, out double h) ? h : FenceSections * FenceSectionHp;
        double after = before - amount;
        int standingBefore = (int)System.Math.Ceiling(before / FenceSectionHp);

        if (after <= 0)
        {
            Destroy(i);
            return standingBefore;
        }

        _hurt[i] = after;
        int standingAfter = (int)System.Math.Ceiling(after / FenceSectionHp);
        return standingBefore - standingAfter;
    }

    public double PieceX(long i) => CityCentre(CityCellX(i));
    public double PieceY(long i) => CityCentre(CityCellY(i));
    public double PieceRadius(long i) => CellHalf(CityKindAt(CityCellX(i), CityCellY(i)));

    /// <summary>NOTHING COMES BACK HERE. A construction site the player opened stays open.</summary>
    public long RegrowBarrel(Rng rng, double px, double py) => -1;
}
