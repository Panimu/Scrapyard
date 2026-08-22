using System.Reflection;
using System.Text.Json;

using Xunit;

namespace Scrapyard.Core.Tests;

/// <summary>
/// Every <see cref="EventKind"/> id and name matches the TypeScript, from
/// <c>goldens/event-kinds-fixture.json</c>.
/// </summary>
/// <remarks>
/// <para>
/// THIS TEST EXISTS BECAUSE ONE OF THEM WAS WRONG. <c>PhaseChanged</c> was ported as <c>6</c>,
/// which is <c>ProjectileExpired</c>, so the end of every run's intro was announced to the renderer
/// as an expiring shell. Nothing failed: the event ring is deliberately excluded from the world
/// hash, and <c>goldens/systems-fixture.json</c> records how MANY events a stage pushed rather than
/// what they were. A bare integer with no reader in the suite is a value that can be anything.
/// </para>
/// <para>
/// So this compares the WHOLE table rather than the ids the ported systems happen to push, and
/// <see cref="EveryDeclaredConstantIsInTheFixture"/> walks the C# class by reflection so that a
/// constant added here later without a fixture row fails rather than going unchecked. A partial
/// check is what let the wrong number sit there in the first place.
/// </para>
/// </remarks>
public class EventKindTests
{
    private static readonly JsonDocument Doc = Fixture.Load("event-kinds-fixture.json");
    private static JsonElement Root => Doc.RootElement;

    /// <summary>The C# constants, by name, read once via reflection.</summary>
    private static Dictionary<string, int> Declared() =>
        typeof(EventKind)
            .GetFields(BindingFlags.Public | BindingFlags.Static)
            .Where(f => f.IsLiteral && f.FieldType == typeof(int))
            .ToDictionary(f => f.Name, f => (int)f.GetRawConstantValue()!);

    [Fact]
    public void EveryFixtureKindMatchesTheDeclaredConstant()
    {
        var declared = Declared();
        var kinds = Root.GetProperty("kinds").EnumerateArray().ToArray();
        Assert.Equal(Root.GetProperty("count").GetInt32(), kinds.Length);

        foreach (var k in kinds)
        {
            string name = k.GetProperty("name").GetString()!;
            int want = k.GetProperty("id").GetInt32();
            Assert.True(declared.TryGetValue(name, out int got),
                $"EventKind.{name} is missing from the C# table (TypeScript has it as {want})");
            Assert.True(want == got, $"EventKind.{name}: expected {want}, got {got}");
        }
    }

    /// <summary>
    /// The other direction: a constant declared here with no fixture row would otherwise be
    /// unchecked, which is precisely the hole this whole file closes.
    /// </summary>
    [Fact]
    public void EveryDeclaredConstantIsInTheFixture()
    {
        var fixtureNames = Root.GetProperty("kinds").EnumerateArray()
            .Select(k => k.GetProperty("name").GetString()!)
            .ToHashSet();

        foreach (var (name, id) in Declared())
        {
            Assert.True(fixtureNames.Contains(name),
                $"EventKind.{name} = {id} has no row in the fixture, so nothing checks it. " +
                "Add it to tools/event_kinds_fixture.ts.");
        }
    }

    /// <summary>
    /// <see cref="EventKind.Names"/> is indexed BY KIND, which is what makes it a cross-check on
    /// the ids rather than decoration: a wrong id and a right name cannot both be true.
    /// </summary>
    [Fact]
    public void NamesAreIndexedByKindAndMatch()
    {
        var names = Root.GetProperty("names").EnumerateArray().Select(e => e.GetString()!).ToArray();
        Assert.Equal(names.Length, EventKind.Names.Length);

        for (int i = 0; i < names.Length; i++)
        {
            Assert.True(names[i] == EventKind.Names[i],
                $"name for kind {i}: expected {names[i]}, got {EventKind.Names[i]}");
        }

        // The ids and the names have to agree with each other, not merely each with the fixture.
        foreach (var k in Root.GetProperty("kinds").EnumerateArray())
        {
            int id = k.GetProperty("id").GetInt32();
            Assert.True(id >= 0 && id < EventKind.Names.Length,
                $"{k.GetProperty("name").GetString()} = {id} is outside the names array");
        }
    }

    /// <summary>
    /// Dense from 0 and with no duplicates - the property that lets <see cref="EventKind.Names"/>
    /// be indexed by kind at all, and the one a renumbering would break.
    /// </summary>
    [Fact]
    public void IdsAreDenseAndDistinct()
    {
        var declared = Declared();
        var byId = new Dictionary<int, string>();
        foreach (var (name, id) in declared)
        {
            Assert.True(!byId.ContainsKey(id), $"EventKind.{byId.GetValueOrDefault(id)} and EventKind.{name} are both {id}");
            byId[id] = name;
        }

        for (int i = 0; i < declared.Count; i++)
        {
            Assert.True(byId.ContainsKey(i), $"event id {i} has no constant - the table is not dense");
        }
    }
}
