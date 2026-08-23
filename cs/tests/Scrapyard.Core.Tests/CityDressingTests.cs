using System.Text.Json;

using Scrapyard.Game;

using Xunit;

namespace Scrapyard.Core.Tests;

/// <summary>
/// City Chaos dresses itself identically, from <c>goldens/city-dressing-fixture.json</c>.
/// </summary>
/// <remarks>
/// <para>
/// Everything here is art only - which litter decal lies in a cell, which of four material piles is
/// stacked in it, which frontage a building wears, where on its roof the AC unit sits. The
/// simulation has never heard of a cone. So a wrong answer cannot break a run; it can only make the
/// two builds show different cities for the same seed, which wastes an afternoon before anyone
/// works out the screenshots were never of the same thing.
/// </para>
/// <para>
/// THE FIXTURE'S CITY IS DELIBERATELY DAMAGED. Rubble, the orphaned-stub pile and the half-broken
/// dim are three of the fiddlier branches in the layer, and a pristine grid reaches none of them.
/// The same damage is replayed here and the resulting broken set is checked BEFORE any dressing is
/// compared - otherwise a disagreement about the damage model would surface as a mysterious
/// argument about rubble sprites.
/// </para>
/// </remarks>
public class CityDressingTests
{
    private static readonly JsonDocument Doc = Fixture.Load("city-dressing-fixture.json");
    private static JsonElement Root => Doc.RootElement;

    /// <summary>
    /// The generator's damage pass, replayed exactly.
    /// </summary>
    /// <remarks>
    /// Same traversal order, same alternation: destroy outright, then take exactly one section off
    /// so the cell dims. Order matters because the cap is a count, not a predicate.
    /// </remarks>
    private static CityBlocks DamagedCity(int seed, int reach)
    {
        var city = new CityBlocks(seed);
        int damaged = 0;
        for (int cy = -reach; cy <= reach && damaged < 40; cy++)
        {
            for (int cx = -reach; cx <= reach && damaged < 40; cx++)
            {
                if (city.CityKindAt(cx, cy) != CityBlocks.CityFence) continue;
                city.Damage(CityBlocks.PackCityCell(cx, cy), damaged % 2 == 0 ? 1e9 : 90);
                damaged++;
            }
        }

        // And the drums, which is a different fact from broken fence - see the felled branch in
        // CityDressingLayout.StreetAt.
        int seen = 0;
        for (int cy = -reach; cy <= reach; cy++)
        {
            for (int cx = -reach; cx <= reach; cx++)
            {
                if (city.CityKindAt(cx, cy) != CityBlocks.CityBarrel) continue;
                if (seen % 2 == 0) city.Damage(CityBlocks.PackCityCell(cx, cy), 1e9);
                seen++;
            }
        }

        return city;
    }

    /// <summary>
    /// THE CELL HASH IS PINNED WHERE IT COULD GO WRONG, NOT ONLY WHERE THE GAME GOES.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <see cref="CityDressingLayout.CellHash"/> uses a 32-bit wrapping multiply on both terms,
    /// unlike the two ground layers, whose opening mixes are plain float64 multiplies. Writing this
    /// one the ground layers' way would be wrong - and would change NOTHING the player can see,
    /// because the arena is about 200 cells across and the two spellings agree exactly until the
    /// product passes 2^53, at around thirteen million. Injecting that fault moved not one cell of
    /// the fixture's window.
    /// </para>
    /// <para>
    /// So the function is pinned instead of the city: coordinates chosen because the wrong multiply
    /// diverges there. It cannot arise in play, and it can certainly arise in a refactor.
    /// </para>
    /// </remarks>
    [Fact]
    public void TheCellHashIsPinnedWhereTheWrongMultiplyWouldDiverge()
    {
        int probes = 0;
        foreach (var p in Root.GetProperty("hashProbes").EnumerateArray())
        {
            int cx = p.GetProperty("cx").GetInt32();
            int cy = p.GetProperty("cy").GetInt32();
            Assert.True(p.GetProperty("h").GetUInt32() == CityDressingLayout.CellHash(cx, cy),
                        $"cell hash differs at ({cx}, {cy})");
            probes++;
        }
        Assert.True(probes >= 12, $"only {probes} hash probes - the large coordinates have gone");
    }

    [Fact]
    public void EveryCellDressesIdentically()
    {
        int reach = Root.GetProperty("reach").GetInt32();
        int cells = 0;

        foreach (var s in Root.GetProperty("seeds").EnumerateArray())
        {
            int seed = s.GetProperty("seed").GetInt32();
            var city = DamagedCity(seed, reach);

            // The damage first, or every later mismatch is a red herring.
            foreach (var b in s.GetProperty("broken").EnumerateArray())
            {
                int cx = b[0].GetInt32(), cy = b[1].GetInt32();
                Assert.True(city.IsCityBroken(cx, cy),
                    $"seed {seed} cell ({cx}, {cy}) should be broken - the damage model diverged, " +
                    "and nothing below this line means anything until it is fixed");
            }
            foreach (var b in s.GetProperty("half").EnumerateArray())
            {
                int cx = b[0].GetInt32(), cy = b[1].GetInt32();
                Assert.True(city.CitySectionsStanding(cx, cy) == 1,
                    $"seed {seed} cell ({cx}, {cy}) should have one section left");
            }

            foreach (var c in s.GetProperty("cells").EnumerateArray())
            {
                int cx = c.GetProperty("cx").GetInt32();
                int cy = c.GetProperty("cy").GetInt32();
                string where = $"seed {seed} cell ({cx}, {cy})";

                Assert.True(c.GetProperty("hash").GetUInt32() == CityDressingLayout.CellHash(cx, cy),
                            $"{where}: cell hash differs");
                Assert.True(c.GetProperty("dash").GetInt32() == CityDressingLayout.DashAt(cx, cy),
                            $"{where}: centre line differs");

                bool litters = CityDressingLayout.LittersHere(city, cx, cy);
                Assert.True(c.GetProperty("litters").GetBoolean() == litters,
                            $"{where}: litters-here differs");

                AssertDecal(c.GetProperty("litter"),
                            litters ? CityDressingLayout.LitterAt(cx, cy) : null, $"{where} litter");
                AssertDecal(c.GetProperty("cone"),
                            litters ? CityDressingLayout.ConeAt(cx, cy) : null, $"{where} cone");

                var (col, row) = CityDressingLayout.RoofTile(city, cx, cy);
                Assert.True(c.GetProperty("col").GetInt32() == col, $"{where}: roof column");
                Assert.True(c.GetProperty("row").GetInt32() == row, $"{where}: roof row");

                bool building = city.CityKindAt(cx, cy) == CityBlocks.CityBuilding;
                AssertDecal(c.GetProperty("prop"),
                            building ? CityDressingLayout.RoofPropAt(cx, cy, col, row) : null,
                            $"{where} roof prop");

                int wantFace = c.GetProperty("face").GetInt32();
                bool hasFace = building
                            && city.CityKindAt(cx, cy + 1) != CityBlocks.CityBuilding;
                Assert.True(hasFace == wantFace >= 0, $"{where}: frontage presence differs");
                if (hasFace)
                {
                    Assert.True(wantFace == CityDressingLayout.FaceVariant(cx, cy),
                                $"{where}: frontage variant");
                }

                var st = CityDressingLayout.StreetAt(city, cx, cy);
                var wantSt = c.GetProperty("street");
                Assert.True(wantSt.GetProperty("kind").GetInt32() == (int)st.Kind,
                            $"{where}: street kind {st.Kind}, expected {wantSt.GetProperty("kind")}");
                if (st.Kind != CityDressingLayout.StreetKind.None)
                {
                    Assert.True(wantSt.GetProperty("index").GetInt32() == st.Index,
                                $"{where}: street sprite index");
                }
                AssertF64(wantSt.GetProperty("alpha"), st.Alpha, $"{where}: street alpha");

                cells++;
            }
        }

        Assert.True(cells >= 5000, $"only {cells} cells were checked");
    }

    /// <summary>
    /// THE FIXTURE IS RE-CHECKED FOR TEETH.
    /// </summary>
    /// <remarks>
    /// The generator counts every branch the window reaches and refuses to write a fixture missing
    /// one. Those counts travel with it, so shrinking the window - or generating from a city nobody
    /// damaged - turns this red rather than quietly leaving rubble, piles and the half-broken dim
    /// unguarded while the comparison above still passes.
    /// </remarks>
    [Fact]
    public void TheWindowReachesEveryBranchOfTheLayer()
    {
        var cov = Root.GetProperty("coverage");
        foreach (string branch in new[]
                 {
                     "road", "dash", "litter", "cone", "building", "face",
                     "roofProp", "fence", "pile", "rubble", "barrel", "halfBroken",
                     // Both kinds of broken cell. A window with only felled FENCE in it is passed
                     // by a port that ignores the pristine kind and shows rubble where a drum was.
                     "felledFence", "felledDrum",
                 })
        {
            Assert.True(cov.GetProperty(branch).GetInt32() > 0, $"the window never reaches {branch}");
        }

        var variants = cov.GetProperty("litterVariants").EnumerateArray()
                          .Select(v => v.GetInt32()).ToList();
        Assert.Equal(Enumerable.Range(0, CityDressingLayout.LitterCount), variants);
    }

    /// <summary>
    /// NO TWO TOUCHING CELLS CAN SHARE A LITTER DECAL, WHICH IS EXACT RATHER THAN LIKELY.
    /// </summary>
    /// <remarks>
    /// <para>
    /// The variant is a LATTICE, not a roll: <c>cx + 2 * cy</c> mod 5 changes by 1 across a
    /// horizontal step, by 2 across a vertical one and by 1 or 3 diagonally, so none of a cell's
    /// eight neighbours can land on the same value. A plain <c>hash % 5</c> is what shipped first
    /// and put two identical cable coils within a couple of metres constantly.
    /// </para>
    /// <para>
    /// This is checked rather than trusted because it is the sort of property that survives a port
    /// by accident and then dies to a plausible-looking simplification. It is a claim about all
    /// eight neighbours, so exhaustion over a window is the honest way to test it.
    /// </para>
    /// </remarks>
    [Fact]
    public void TheLitterLatticeGivesNoNeighbourTheSameDecal()
    {
        for (int cy = -60; cy <= 60; cy++)
        {
            for (int cx = -60; cx <= 60; cx++)
            {
                int here = CityDressingLayout.LitterVariant(cx, cy);
                Assert.InRange(here, 0, CityDressingLayout.LitterCount - 1);

                for (int dy = -1; dy <= 1; dy++)
                {
                    for (int dx = -1; dx <= 1; dx++)
                    {
                        if (dx == 0 && dy == 0) continue;
                        Assert.True(here != CityDressingLayout.LitterVariant(cx + dx, cy + dy),
                            $"({cx}, {cy}) and its neighbour ({cx + dx}, {cy + dy}) both take " +
                            $"decal {here} - the lattice has become a roll");
                    }
                }
            }
        }
    }

    private static void AssertDecal(JsonElement want, CityDressingLayout.Decal? got, string where)
    {
        if (want.ValueKind == JsonValueKind.Null)
        {
            Assert.True(got is null, $"{where}: drawn here, but the original draws nothing");
            return;
        }

        Assert.True(got is not null, $"{where}: nothing drawn, but the original draws one");
        var d = got!.Value;
        Assert.True(want.GetProperty("variant").GetInt32() == d.Variant, $"{where}: variant");
        AssertF64(want.GetProperty("x"), d.X, $"{where}: x");
        AssertF64(want.GetProperty("y"), d.Y, $"{where}: y");
        AssertF64(want.GetProperty("size"), d.Size, $"{where}: size");
        AssertF64(want.GetProperty("rotation"), d.Rotation, $"{where}: rotation");
    }

    private static void AssertF64(JsonElement want, double actual, string where)
    {
        ulong w = Convert.ToUInt64(want.GetString()!, 16);
        ulong g = BitConverter.DoubleToUInt64Bits(actual);
        Assert.True(w == g, $"{where}: expected {BitConverter.UInt64BitsToDouble(w)}, got {actual}");
    }
}
