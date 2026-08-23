using System.Reflection;

namespace Scrapyard.Game;

/// <summary>
/// Which build this is.
/// </summary>
/// <remarks>
/// <para>
/// <b>COMPUTED BY THE BUILD, NOT STORED IN THE REPOSITORY.</b> The version is the commit count plus
/// the short SHA, and it is stamped onto the assembly by a target in the csproj rather than written
/// into a file - because a generated file is a file that can be stale, committed by accident, or
/// forgotten in <c>.gitignore</c>. This value cannot drift from the build carrying it: it does not
/// exist until the build makes it.
/// </para>
/// <para>
/// <b>THE COUNT IS NOT A NUMBER SOMEBODY MAINTAINS.</b> Storing a counter in the repository would
/// move it on every local build, and every move is a diff. A commit count is already exactly the
/// monotonic number a version wants to be, and nobody has to remember to bump it.
/// </para>
/// <para>
/// <b>IT READS "dev build" WHEN IT DOES NOT KNOW</b>, which is honest rather than a version number
/// that means nothing. That happens outside a git checkout, and it happens on a SHALLOW CLONE -
/// where <c>rev-list --count</c> reports 1 however many commits there really are, which is why the
/// deploy fetches the full history and why a count of 1 is treated as no answer at all.
/// </para>
/// </remarks>
public static class BuildInfo
{
    /// <summary>What the title screen prints. A serial number, not a feature.</summary>
    public static readonly string Label = ReadLabel();

    private static string ReadLabel()
    {
        var attr = Assembly.GetEntryAssembly()
            ?.GetCustomAttribute<AssemblyInformationalVersionAttribute>();
        return Format(attr?.InformationalVersion);
    }

    /// <summary>
    /// The stamped version, turned into what a player sees.
    /// </summary>
    /// <remarks>
    /// <para>
    /// SEPARATE FROM THE READING so the rule can be tested without a build. The shape is
    /// <c>count+sha</c>, and anything that is not that shape - an empty string, a bare assembly
    /// version .NET filled in on its own, a count of 1 from a shallow clone - is not a version this
    /// build knows and says so.
    /// </para>
    /// <para>
    /// A COUNT OF 1 IS TREATED AS UNKNOWN. That is what a shallow clone reports forever, and a
    /// build that confidently calls itself v1 on every deploy is worse than one that admits it does
    /// not know which build it is.
    /// </para>
    /// </remarks>
    public static string Format(string? informational)
    {
        if (string.IsNullOrWhiteSpace(informational)) return "dev build";

        int plus = informational.IndexOf('+');
        if (plus <= 0 || plus == informational.Length - 1) return "dev build";

        string count = informational[..plus];
        string sha = informational[(plus + 1)..];
        if (count.Length == 0 || sha.Length == 0) return "dev build";
        if (count == "1") return "dev build";

        foreach (char c in count)
        {
            if (c < '0' || c > '9') return "dev build";
        }

        return $"v{count} - {sha}";
    }
}
