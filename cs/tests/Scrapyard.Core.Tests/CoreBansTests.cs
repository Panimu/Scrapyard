using System.Collections.Generic;
using System.IO;
using System.Text;
using System.Text.RegularExpressions;

using Xunit;

namespace Scrapyard.Core.Tests;

/// <summary>
/// NOTHING IN THE PORTED CORE CALLS AN IMPLEMENTATION-APPROXIMATED MATH FUNCTION.
/// </summary>
/// <remarks>
/// <para>
/// THE C# SIDE OF <c>tests/coreBans.test.ts</c>, and it did not exist. That scanner walks
/// <c>src/core</c> and stops there, so the rule it enforces was enforced in TypeScript only - while
/// the language this game actually ships in on Windows and iOS had the ban written down in prose
/// and checked by nobody. The TypeScript file's own header explains what prose is worth here:
/// eighteen call sites accumulated across five files while the rule sat in CLAUDE.md, because the
/// failure is invisible on the machine you test on.
/// </para>
/// <para>
/// <b>THE GOLDEN CORPUS IS NOT THIS TEST.</b> It replays TypeScript-recorded runs through the C#,
/// so it would catch a <c>Math.Sin</c> that disagreed with <c>dsin</c> - but only on the paths nine
/// runs happen to exercise, and only for divergence FROM TYPESCRIPT. It says nothing about the
/// case that matters for the roadmap: the same C# binary giving different bits on x64 Windows and
/// on ARM64, where <c>Math.Sin</c> is whatever the platform's libm does. Nothing checks that, and
/// by the time a replay fails to reproduce, the call site that did it is indistinguishable from
/// the other seventeen.
/// </para>
/// <para>
/// WHAT IS BANNED AND WHAT IS NOT is the same division ECMA-262 makes, because .NET makes it in the
/// same place: <c>Sqrt</c> is IEEE-754 correctly-rounded and <c>Floor</c>, <c>Abs</c>, <c>Min</c>,
/// <c>Max</c>, <c>Round</c>, <c>Sign</c>, <c>Truncate</c> and <c>Clamp</c> are exact, so core uses
/// them freely. The transcendentals are not, and <c>Math.Pow</c> is on the list beside them - which
/// is why <c>CycleLadder</c> extrapolates with a loop of multiplies rather than a power.
/// </para>
/// <para>
/// IT SCANS <c>MathCore.cs</c> TOO, with no exemption, for the reason its TypeScript counterpart
/// scans <c>trig.ts</c>: that is the file whose whole purpose is to not do this, so it is the last
/// one that should get a pass. Its prose necessarily names the banned functions a dozen times,
/// which is exactly why this strips comments rather than keeping a list of allowed files.
/// </para>
/// </remarks>
public class CoreBansTests
{
    /// <summary>Implementation-approximated in .NET, plus the nondeterministic one.</summary>
    /// <remarks>
    /// <c>Random</c> is here as a type name rather than a <c>Math</c> member - C# spells it
    /// <c>new Random()</c> - and is checked separately below.
    /// </remarks>
    private static readonly string[] Banned =
    {
        "Acos", "Acosh", "Asin", "Asinh", "Atan", "Atanh", "Atan2", "Cbrt",
        "Cos", "Cosh", "Exp", "Log", "Log2", "Log10", "Pow", "Sin", "Sinh",
        "Tan", "Tanh", "ScaleB", "ILogB", "BitDecrement", "BitIncrement",
    };

    /// <summary>The projects that must hold the line, and the one that need not.</summary>
    /// <remarks>
    /// <c>Scrapyard.Meta</c> IS INCLUDED. It is not the simulation, but it reads
    /// <c>World.Stats</c> and decides what a save is owed, and a career total that differed by a
    /// bit between two machines would be a different unlock on each. <c>Scrapyard.Game</c> is
    /// deliberately absent: it draws, and a renderer is entitled to a sine.
    /// </remarks>
    private static readonly string[] Projects = { "Scrapyard.Core", "Scrapyard.Meta" };

    private static string SourceRoot()
    {
        var dir = new DirectoryInfo(System.AppContext.BaseDirectory);
        while (dir is not null)
        {
            string src = Path.Combine(dir.FullName, "src");
            if (Directory.Exists(Path.Combine(src, "Scrapyard.Core"))) return src;
            dir = dir.Parent;
        }

        throw new DirectoryNotFoundException(
            $"Could not find the C# sources above {System.AppContext.BaseDirectory}.");
    }

    /// <summary>
    /// Every <c>.cs</c> file in a project, skipping the build's own output.
    /// </summary>
    /// <remarks>
    /// <c>bin</c> AND <c>obj</c> ARE SKIPPED because both hold generated copies - the XML doc file
    /// and the assembly-info source - and a scanner that read them would report every paragraph
    /// that MENTIONS a banned call as a call.
    /// </remarks>
    private static List<string> SourcesIn(string project)
    {
        var found = new List<string>();
        void Walk(string dir)
        {
            foreach (string sub in Directory.GetDirectories(dir))
            {
                string name = Path.GetFileName(sub);
                if (name is "bin" or "obj") continue;
                Walk(sub);
            }
            foreach (string f in Directory.GetFiles(dir, "*.cs")) found.Add(f);
        }

        Walk(Path.Combine(SourceRoot(), project));
        return found;
    }

    /// <summary>
    /// Removes comments, so the ban is about code rather than about prose.
    /// </summary>
    /// <remarks>
    /// Deliberately simple, and the same shape as the TypeScript's: a block-comment state machine,
    /// then everything from a <c>//</c> to the end of the line - which takes C#'s <c>///</c> doc
    /// comments with it. It does not understand string literals, so a string containing <c>//</c>
    /// is truncated at it. That is accepted for the same reason it is accepted there: the
    /// alternative is a C# tokeniser, which is a great deal of machinery to defend against a line
    /// nobody would write.
    /// </remarks>
    private static string StripComments(string src)
    {
        var outv = new StringBuilder();
        bool inBlock = false;
        foreach (string raw in src.Split('\n'))
        {
            string line = raw;
            if (inBlock)
            {
                int end = line.IndexOf("*/", System.StringComparison.Ordinal);
                if (end < 0) { outv.Append('\n'); continue; }
                line = line[(end + 2)..];
                inBlock = false;
            }

            // Repeated: one line can open and close several block comments and still hold code.
            while (true)
            {
                int start = line.IndexOf("/*", System.StringComparison.Ordinal);
                if (start < 0) break;
                int end = line.IndexOf("*/", start + 2, System.StringComparison.Ordinal);
                if (end < 0) { line = line[..start]; inBlock = true; break; }
                line = line[..start] + " " + line[(end + 2)..];
            }

            int slash = line.IndexOf("//", System.StringComparison.Ordinal);
            outv.Append(slash >= 0 ? line[..slash] : line).Append('\n');
        }

        return outv.ToString();
    }

    private static Regex CallRegex() =>
        new(@"\bMath\s*\.\s*(" + string.Join("|", Banned) + @")\s*\(");

    /// <summary>A scanner that silently walks an empty directory passes forever.</summary>
    [Fact]
    public void ItFindsTheCoreSourcesAtAll()
    {
        int n = 0;
        foreach (string p in Projects) n += SourcesIn(p).Count;
        Assert.True(n > 30, $"only {n} source files found - the scan is not looking at core");
    }

    [Fact]
    public void NoImplementationApproximatedMathCallInCore()
    {
        var hits = new List<string>();
        foreach (string project in Projects)
        {
            foreach (string file in SourcesIn(project))
            {
                string[] lines = StripComments(File.ReadAllText(file)).Split('\n');
                for (int i = 0; i < lines.Length; i++)
                {
                    foreach (Match m in CallRegex().Matches(lines[i]))
                    {
                        hits.Add($"{file}:{i + 1}  Math.{m.Groups[1].Value}(  " +
                                 "-- use Scrapyard.Core.MathCore");
                    }
                }
            }
        }

        // REPORTED AS A COUNT AND A MESSAGE rather than as a string comparison: xunit truncates a
        // long string diff at the first difference, which on a real violation hides every hit
        // after the first - and the whole point is to see all of them at once.
        Assert.True(hits.Count == 0,
            $"{hits.Count} banned call(s) in the ported core:\n" + string.Join("\n", hits));
    }

    /// <summary>
    /// AND NOTHING IN CORE MAKES ITS OWN RANDOMNESS.
    /// </summary>
    /// <remarks>
    /// The other half of <c>Math.random</c>'s ban, which C# spells as a type. Core draws from the
    /// seeded streams on <c>World.Rng</c> and from nothing else - a <c>new Random()</c> anywhere in
    /// the simulation is a run that cannot be replayed, and unlike a last-bit difference it does
    /// not even need two machines to go wrong.
    /// </remarks>
    [Fact]
    public void NoUnseededRandomnessInCore()
    {
        var hits = new List<string>();
        var re = new Regex(@"\bnew\s+(System\s*\.\s*)?Random\s*\(|\bGuid\s*\.\s*NewGuid\s*\(|" +
                           @"\bEnvironment\s*\.\s*TickCount|\bDateTime\s*\.\s*(Now|UtcNow)");
        foreach (string project in Projects)
        {
            foreach (string file in SourcesIn(project))
            {
                string[] lines = StripComments(File.ReadAllText(file)).Split('\n');
                for (int i = 0; i < lines.Length; i++)
                {
                    foreach (Match m in re.Matches(lines[i]))
                    {
                        hits.Add($"{file}:{i + 1}  {m.Value.Trim()}  -- core takes no wall clock " +
                                 "and no unseeded randomness");
                    }
                }
            }
        }

        Assert.True(hits.Count == 0,
            $"{hits.Count} unseeded source(s) of variation in the ported core:\n" +
            string.Join("\n", hits));
    }

    /// <summary>
    /// The scanner is only worth having if it actually matches.
    /// </summary>
    /// <remarks>
    /// Pinned against the shapes a real violation takes, the spaced-out one a formatter can produce
    /// included - and against the prose that must NOT match, which is the only reason the comment
    /// stripping exists.
    /// </remarks>
    [Fact]
    public void ItWouldCatchAViolationAndNotCatchProse()
    {
        string bad = StripComments(
            "var a = Math.Sin(x);\n" +
            "var b = Math . Cos ( y );\n" +
            "var c = System.Math.Atan2(y, x);\n" +
            "var d = Math.Pow(v, 2);\n");
        var got = new List<string>();
        foreach (Match m in CallRegex().Matches(bad)) got.Add(m.Groups[1].Value);
        Assert.Equal(new[] { "Sin", "Cos", "Atan2", "Pow" }, got);

        string prose = StripComments(
            "/* Math.Sin(x) is banned here. */\n" +
            "// and so is Math.Pow(a, b)\n" +
            "/// <summary>See <c>Math.Cos</c>.</summary>\n" +
            "var ok = Math.Sqrt(v); // unlike Math.Cos(v)\n");
        Assert.Empty(CallRegex().Matches(prose));
        Assert.Contains("Math.Sqrt", prose);
    }
}
