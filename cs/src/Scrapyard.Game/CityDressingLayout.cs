using Scrapyard.Core;

namespace Scrapyard.Game;

/// <summary>
/// What City Chaos scatters over itself, and where. Port of the art-only half of
/// <c>src/render/dressingCity.ts</c>.
/// </summary>
/// <remarks>
/// <para>
/// <b>THE SIMULATION HAS NEVER HEARD OF A CONE.</b> Everything decided here is decoration: litter
/// decals, traffic cones, roof furniture, which frontage a building wears, which of four material
/// piles is stacked in a cell. None of it collides, none of it is stored, and none of it may reach
/// <c>World</c> - a purely visual change to how messy a site looks must not be able to alter a
/// recorded run.
/// </para>
/// <para>
/// <b>NO MONOGAME IN HERE, so the test project can compile this exact source</b> rather than a
/// second transcription of it. Which cell gets what is the part worth pinning against the web
/// build; putting a texture on the screen is not.
/// </para>
/// <para>
/// <b>AND THIS HASH IS GENUINELY <c>Math.imul</c> ON BOTH TERMS</b>, unlike
/// <see cref="GroundCoverLayout"/> and <see cref="GroundPathsLayout"/>, whose opening mixes are
/// plain float64 multiplies. The two look identical at a glance and are not - which is exactly why
/// the rule is to read the original rather than apply a remembered one.
/// </para>
/// </remarks>
public static class CityDressingLayout
{
    /// <summary>
    /// Face height, world units.
    /// </summary>
    /// <remarks>
    /// Matches the 128x72 bake: 72 px at the 2x scale is 36 units, hung into the empty cell below
    /// the building's southern edge.
    /// </remarks>
    public const double FaceHeight = 36;

    /// <summary>
    /// What fraction of interior roof cells carry an AC unit, vent or skylight.
    /// </summary>
    /// <remarks>
    /// Low on purpose - a roofscape where every slab has furniture reads as a pattern, and the
    /// props exist to break patterns up.
    /// </remarks>
    public const double PropShare = 0.22;

    /// <summary>Roof furniture, comfortably smaller than the machines below.</summary>
    public const double PropSize = 26;

    /// <summary>
    /// Litter density, as thresholds on a per-cell hash roll.
    /// </summary>
    /// <remarks>
    /// Ground decals land on roughly a fifth of a site's open cells and cones on a twentieth. A
    /// site should read as messy at a glance and still leave the ground legible, because the litter
    /// shares its palette with things that DO matter - fence orange, pile browns - and a floor of
    /// it would bury them.
    /// </remarks>
    public const double LitterShare = 0.21;

    public const double ConeShare = 0.05;

    /// <summary>Decal sizes, world units. Well under the 64 u cell, so litter reads as ON the ground.</summary>
    public const double LitterSize = 34;

    public const double ConeSize = 24;

    public const int FaceCount = 4;
    public const int FenceVariants = 2;
    public const int PileCount = 4;
    public const int RubbleCount = 2;
    public const int LitterCount = 5;
    public const int ConeCount = 2;
    public const int RoofPropCount = 3;

    /// <summary>
    /// One hash per cell for the art-only choices - which face variant, which prop, which rubble.
    /// </summary>
    /// <remarks>
    /// DELIBERATELY NOT THE SIMULATION'S HASH: nothing the simulation can see is decided here, and
    /// borrowing a stream would couple the horde to how much mess is on the pavement.
    /// </remarks>
    public static uint CellHash(int cx, int cy)
    {
        unchecked
        {
            // BOTH OF THESE ARE Math.imul - a 32-bit wrapping multiply - unlike the ground layers,
            // whose opening mixes are plain float64 multiplies that lose bits past 2^53. Same
            // shape on the page, different function.
            int h = (cx * 0x27d4eb2f) ^ (cy * unchecked((int)0x9e3779b1));
            h ^= (int)((uint)h >> 15);
            h *= unchecked((int)0x85ebca6b);
            h ^= (int)((uint)h >> 13);
            return (uint)h;
        }
    }

    /// <summary>
    /// WHICH DECAL, CHOSEN SO THAT NO TWO CELLS TOUCHING EACH OTHER CAN SHARE ONE.
    /// </summary>
    /// <remarks>
    /// <para>
    /// A plain <c>hash % Count</c> is what shipped first, and with five variants on a fifth of the
    /// cells it put two identical cable coils or two identical paint crosses within a couple of
    /// metres constantly - the exact thing that reads as tiled rather than strewn.
    /// </para>
    /// <para>
    /// The fix is a LATTICE rather than a roll. <c>cx + 2 * cy</c> mod the variant count changes by
    /// 1 across a horizontal step, by 2 across a vertical one and by 1 or 3 diagonally, so for any
    /// count of 3 or more none of a cell's eight neighbours can land on the same variant. It is
    /// exact, it is one multiply, and unlike "roll again if a neighbour matches" there is no
    /// order-dependence and no cycle to reason about.
    /// </para>
    /// <para>
    /// WHY THE REGULARITY DOES NOT SHOW: a lattice repeats on a diagonal every Count cells, but
    /// only a fifth of cells carry litter at all and each instance takes its own rotation and size
    /// from the cell hash. What reaches the screen is a handful of differently-turned objects
    /// merely guaranteed not to have a twin beside them.
    /// </para>
    /// </remarks>
    public static int LitterVariant(int cx, int cy)
    {
        int v = (cx + 2 * cy) % LitterCount;
        return v < 0 ? v + LitterCount : v;
    }

    /// <summary>
    /// Whether this cell carries the painted centre line, and which way it runs.
    /// </summary>
    /// <remarks>
    /// The line runs on the seam between a road's two cells - the far edge of its FIRST cell.
    /// CROSSINGS STAY UNPAINTED: a box junction with lines through it reads as a rendering bug even
    /// to someone who could not say why.
    /// </remarks>
    public static int DashAt(int cx, int cy)
    {
        bool roadX = CityBlocks.CityIsRoadCell(cx);
        bool roadY = CityBlocks.CityIsRoadCell(cy);
        if (roadX && !roadY && FirstOfPair(cx)) return 1;   // vertical road, line runs north-south
        if (roadY && !roadX && FirstOfPair(cy)) return 2;   // horizontal road
        return 0;
    }

    private static bool FirstOfPair(int v)
    {
        int m = ((v + 1) % CityBlocks.CityPeriod + CityBlocks.CityPeriod) % CityBlocks.CityPeriod;
        return m == CityBlocks.CityRoadCells - 2;
    }

    /// <summary>One litter decal: which sprite, where in the cell, how big, how turned.</summary>
    public readonly record struct Decal(int Variant, double X, double Y, double Size, double Rotation);

    /// <summary>
    /// The ground decal in this cell, if any.
    /// </summary>
    /// <remarks>
    /// Size varies plus or minus 20% per instance. <see cref="LitterVariant"/> already guarantees
    /// no NEIGHBOUR shares a variant; this is what keeps two of the same piece elsewhere on screen
    /// from reading as a copy-paste.
    /// </remarks>
    public static Decal? LitterAt(int cx, int cy)
    {
        uint h = CellHash(cx, cy);
        if (!((h & 0xfff) / 4096.0 < LitterShare)) return null;

        int variant = LitterVariant(cx, cy);
        return new Decal(
            variant,
            (cx + 0.28 + ((h >> 16) & 127) / 288.0) * CityBlocks.CityCell,
            (cy + 0.28 + ((h >> 23) & 127) / 288.0) * CityBlocks.CityCell,
            LitterSize * (0.8 + ((h >> 2) & 63) / 160.0),
            // Stains, spills and cable land at any angle; only the paint marks (4) stay square,
            // because a surveyor sprays along the grid they are marking out.
            variant == 4 ? 0 : ((h >> 4) & 255) * 0.0245);
    }

    /// <summary>
    /// The traffic cone in this cell, if any.
    /// </summary>
    /// <remarks>
    /// NEVER ROTATED: the cone's shadow is baked in, and a shadow that swung round per cone would
    /// read as five suns. The knocked-over variant carries its own angle.
    /// </remarks>
    public static Decal? ConeAt(int cx, int cy)
    {
        uint h = CellHash(cx, cy);
        if (!(((h >> 19) & 0xfff) / 4096.0 < ConeShare)) return null;

        return new Decal(
            (int)((h >> 9) % ConeCount),
            (cx + 0.32 + ((h >> 13) & 63) / 192.0) * CityBlocks.CityCell,
            (cy + 0.32 + ((h >> 26) & 63) / 192.0) * CityBlocks.CityCell,
            ConeSize,
            0);
    }

    /// <summary>
    /// The roof furniture on this cell, if any.
    /// </summary>
    /// <remarks>
    /// INTERIOR SLAB ONLY - a parapet with an AC unit balanced on it reads as a mistake, and the
    /// thin autotile pieces have no interior at all. Hence the caller passing the tile's column and
    /// row rather than this re-deriving them.
    /// </remarks>
    public static Decal? RoofPropAt(int cx, int cy, int col, int row)
    {
        if (col != 1 || row != 1) return null;
        uint h = CellHash(cx, cy);
        if (!(h / 4294967296.0 < PropShare)) return null;

        return new Decal(
            (int)((h >> 8) % RoofPropCount),
            (cx + 0.3 + ((h >> 12) % 128) / 320.0) * CityBlocks.CityCell,
            (cy + 0.3 + ((h >> 19) % 128) / 320.0) * CityBlocks.CityCell,
            PropSize,
            0);
    }

    /// <summary>The frontage variant hung below a building cell with nothing under it.</summary>
    public static int FaceVariant(int cx, int cy) => (int)(CellHash(cx, cy + 1) % FaceCount);

    /// <summary>The autotile column and row for a building cell, from its four neighbours.</summary>
    public static (int Col, int Row) RoofTile(CityBlocks city, int cx, int cy)
    {
        bool Solid(int x, int y) => city.CityKindAt(x, y) == CityBlocks.CityBuilding;
        bool left = Solid(cx - 1, cy), right = Solid(cx + 1, cy);
        bool up = Solid(cx, cy - 1), down = Solid(cx, cy + 1);
        int col = !left && !right ? 3 : !left ? 0 : !right ? 2 : 1;
        int row = !up && !down ? 3 : !up ? 0 : !down ? 2 : 1;
        return (col, row);
    }

    /// <summary>What a breakable or felled cell shows: a fence piece, a material pile, or rubble.</summary>
    public enum StreetKind
    {
        None,
        Fence,
        Pile,
        Rubble,
    }

    /// <summary>A cell's street-level dressing: which sprite, and whether it is drawn dimmed.</summary>
    public readonly record struct Street(StreetKind Kind, int Index, double Alpha);

    /// <summary>
    /// What stands - or lies - in this cell at street level.
    /// </summary>
    /// <remarks>
    /// <para>
    /// A BREAKABLE CELL ON THE BLOCK'S WALL RING IS SITE FENCING; one deeper inside is a material
    /// pile. The split used to be "has it a fence neighbour", which broke two ways at once: a pile
    /// that happened to touch the ring dressed itself as a stray fence segment, and the ring cell
    /// it touched sprouted an arm toward it. Ring membership is the actual fact, and the simulation
    /// owns it.
    /// </para>
    /// <para>
    /// A ring cell picks its piece by which NEIGHBOURING RING CELLS are still standing - the same
    /// N/E/S/W mask the scrap paths use - so corners, tees and ends all get real art, and breaking
    /// a cell heals its neighbours' masks into end pieces on the next frame. A ring cell with no
    /// standing ring neighbours falls back to a pile rather than indexing piece -1: a lone orphaned
    /// stub of barrier.
    /// </para>
    /// <para>
    /// A BROKEN DRUM LEAVES NOTHING. Fences and drums share the broken set, so "was something here"
    /// is true for both - and rubble is fence rubble, splintered boards and a length of hazard
    /// board, which is nonsense lying where a fuel drum went up. Asking what was ORIGINALLY in the
    /// cell is the only way to tell the two apart after the fact; the drum gets the scorch mark the
    /// effects layer already draws, and that is the whole of its aftermath.
    /// </para>
    /// <para>
    /// The half-damaged state DIMS - one section down of two - which with a 64-unit cell is as much
    /// health bar as a fence deserves.
    /// </para>
    /// </remarks>
    public static Street StreetAt(CityBlocks city, int cx, int cy)
    {
        int kind = city.CityKindAt(cx, cy);
        uint h = CellHash(cx, cy);

        bool felled = kind == CityBlocks.CityEmpty
                   && city.IsCityBroken(cx, cy)
                   && CityBlocks.CityPristineKindAt(city.Seed, cx, cy) == CityBlocks.CityFence;
        if (felled) return new Street(StreetKind.Rubble, (int)(h % RubbleCount), 1);

        if (kind != CityBlocks.CityFence) return new Street(StreetKind.None, 0, 1);

        double alpha = city.CitySectionsStanding(cx, cy) == 1 ? 0.62 : 1;

        if (!CityBlocks.CityFenceRing(cx, cy))
        {
            return new Street(StreetKind.Pile, (int)(h % PileCount), alpha);
        }

        bool RingFence(int x, int y) =>
            city.CityKindAt(x, y) == CityBlocks.CityFence && CityBlocks.CityFenceRing(x, y);

        int mask = 0;
        if (RingFence(cx, cy - 1)) mask |= 1;
        if (RingFence(cx + 1, cy)) mask |= 2;
        if (RingFence(cx, cy + 1)) mask |= 4;
        if (RingFence(cx - 1, cy)) mask |= 8;

        if (mask == 0) return new Street(StreetKind.Pile, (int)(h % PileCount), alpha);

        return new Street(StreetKind.Fence,
                          (mask - 1) * FenceVariants + (int)((h >> 6) % FenceVariants),
                          alpha);
    }

    /// <summary>
    /// Whether this cell is open ground that a construction site would litter.
    /// </summary>
    /// <remarks>
    /// The interior AND the pavement apron, because a working site's mess never respects its own
    /// hoarding line. Skipped on felled cells so the rubble stays legible as "the fence you broke".
    /// </remarks>
    public static bool LittersHere(CityBlocks city, int cx, int cy) =>
        city.CityKindAt(cx, cy) == CityBlocks.CityEmpty
        && !city.IsCityBroken(cx, cy)
        && CityBlocks.CityIsConstructionBlock(city.Seed, cx, cy);
}
