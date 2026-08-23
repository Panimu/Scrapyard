using System.Text.Json;

namespace Scrapyard.Core.Tests;

/// <summary>
/// Loads the JSON fixtures the TypeScript emits. These files are the oracle; nothing in this test
/// project computes an expected value of its own.
/// </summary>
internal static class Fixture
{
    /// <summary>
    /// Walks up from the test assembly to the repository root.
    /// </summary>
    /// <remarks>
    /// Found by looking for the marker rather than by counting <c>..</c> segments, because the
    /// number of segments depends on the target framework and configuration in the output path and
    /// would break the first time either changed. The marker is the goldens directory itself: if it
    /// is missing there is nothing to test against, so failing here is correct.
    /// </remarks>
    private static string RepoRoot
    {
        get
        {
            var dir = new DirectoryInfo(AppContext.BaseDirectory);
            while (dir is not null)
            {
                if (Directory.Exists(Path.Combine(dir.FullName, "goldens"))) return dir.FullName;
                dir = dir.Parent;
            }

            throw new DirectoryNotFoundException(
                $"Could not find a 'goldens' directory above {AppContext.BaseDirectory}. " +
                "Run `npm run golden:rng` and `npm run golden -- record` from the repository root.");
        }
    }

    /// <summary>
    /// The golden corpus, through the SAME reader the replayer uses.
    /// </summary>
    /// <remarks>
    /// Not a second parser. Two readers of one format is two chances to disagree about what the
    /// format is, and the one that disagrees quietly is the one nobody is looking at.
    /// </remarks>
    public static (Scrapyard.Golden.CorpusRun[] Runs, string Path) LoadCorpus()
    {
        string path = System.IO.Path.Combine(RepoRoot, "goldens", "corpus.json");
        if (!File.Exists(path))
        {
            throw new FileNotFoundException(
                $"The golden corpus is missing at {path}. Run `npm run golden -- record`.", path);
        }
        return (Scrapyard.Golden.Corpus.Load(path).ToArray(), path);
    }

    public static JsonDocument Load(string name)
    {
        string path = Path.Combine(RepoRoot, "goldens", name);
        if (!File.Exists(path))
        {
            throw new FileNotFoundException(
                $"Missing fixture {path}. Regenerate it from the TypeScript side.", path);
        }

        return JsonDocument.Parse(File.ReadAllBytes(path));
    }

    /// <summary>An 8-hex-digit u32, as the fixtures write them.</summary>
    public static uint U32(this JsonElement e) =>
        Convert.ToUInt32(e.GetString()!, 16);

    /// <summary>
    /// A double from its 16-hex-digit IEEE-754 bit pattern, high word first.
    /// <para>
    /// Reconstructed from bits rather than parsed from a decimal on purpose - see the header of
    /// tools/rng_fixture.ts. Comparing on bits removes the question of whether two languages'
    /// decimal parsers round identically, which has nothing to do with the simulation.
    /// </para>
    /// </summary>
    public static double F64(this JsonElement e)
    {
        string hex = e.GetString()!;
        ulong bits = Convert.ToUInt64(hex, 16);
        return BitConverter.Int64BitsToDouble(unchecked((long)bits));
    }

    /// <summary>Bit-exact comparison, so -0.0 != +0.0 and NaN == NaN by pattern.</summary>
    public static long Bits(double v) => BitConverter.DoubleToInt64Bits(v);
}
