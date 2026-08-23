using Scrapyard.Game;

using Xunit;

namespace Scrapyard.Core.Tests;

/// <summary>
/// The build label says which build this is, or admits it does not know.
/// </summary>
/// <remarks>
/// <para>
/// A VERSION NUMBER THAT MEANS NOTHING IS WORSE THAN NONE. The label is only ever read when
/// somebody is reporting a bug, so "dev build" - which says "do not quote this at me" - is more
/// useful than a confident number that is the same on every machine.
/// </para>
/// <para>
/// THE SHALLOW-CLONE CASE IS THE ONE THAT BITES. <c>git rev-list --count HEAD</c> reports 1 on a
/// shallow clone however many commits there really are, so a CI job that forgot to fetch full
/// history would stamp every deploy v1 and nothing would look wrong. The web build's deploy
/// workflow fetches with full depth for exactly this reason; the guard is the belt to that
/// bracing.
/// </para>
/// </remarks>
public class BuildInfoTests
{
    [Fact]
    public void ARealStampBecomesAVersion()
    {
        Assert.Equal("v338 - 800815e", BuildInfo.Format("338+800815e"));
        Assert.Equal("v2 - abc1234", BuildInfo.Format("2+abc1234"));
        Assert.Equal("v99999 - deadbee", BuildInfo.Format("99999+deadbee"));
    }

    /// <summary>
    /// ANYTHING THAT IS NOT A STAMP READS AS "dev build".
    /// </summary>
    /// <remarks>
    /// Including the shapes .NET fills in on its own when nothing stamped the assembly - a bare
    /// <c>1.0.0</c> has no plus in it and is not a commit count, and treating it as one would print
    /// a version that is the same on every machine and means nothing.
    /// </remarks>
    [Fact]
    public void AnythingElseAdmitsItDoesNotKnow()
    {
        foreach (string? s in new[]
                 {
                     null, "", "   ", "1.0.0", "1.0.0.0", "dev", "+abc1234", "338+",
                     "+", "abc+1234", "3.3.8+800815e", "v338+800815e",
                 })
        {
            Assert.Equal("dev build", BuildInfo.Format(s));
        }
    }

    /// <summary>
    /// A COUNT OF 1 IS A SHALLOW CLONE, NOT THE FIRST COMMIT.
    /// </summary>
    /// <remarks>
    /// The distinction cannot be made from the number, so the number is not trusted: a repository
    /// genuinely one commit old loses its version label, and a CI job that forgot to fetch history
    /// stops silently claiming to be v1 on every deploy. The second is the failure worth
    /// preventing, and the first costs one commit's worth of nothing.
    /// </remarks>
    [Fact]
    public void ACountOfOneIsNotTrusted()
    {
        Assert.Equal("dev build", BuildInfo.Format("1+800815e"));

        // Two is, which is the boundary either side of the guard.
        Assert.Equal("v2 - 800815e", BuildInfo.Format("2+800815e"));
    }

    /// <summary>
    /// The label the running assembly actually carries is one of the two shapes.
    /// </summary>
    /// <remarks>
    /// THE TEST RUNNER IS NOT THE GAME, so this cannot assert a specific version - the entry
    /// assembly here is the test host and may carry anything at all. What it can assert is that
    /// whatever it carries comes out as something a player could read, which is the property that
    /// matters: the label is never blank, never an exception, and never a raw stamp.
    /// </remarks>
    [Fact]
    public void TheRunningLabelIsAlwaysReadable()
    {
        Assert.False(string.IsNullOrWhiteSpace(BuildInfo.Label));
        Assert.DoesNotContain('+', BuildInfo.Label);
        Assert.True(BuildInfo.Label == "dev build" || BuildInfo.Label.StartsWith('v'),
                    $"the build label is '{BuildInfo.Label}', which is neither a version nor an " +
                    "admission that there is not one");
    }
}
