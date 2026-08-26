using Scrapyard.Core;

namespace Scrapyard.Game;

/// <summary>
/// Which icon a card wears at a given tier.
/// </summary>
/// <remarks>
/// <para>
/// AN EXTENSION RATHER THAN A MEMBER, because <see cref="CardText"/> lives in a GENERATED file
/// (<c>tools/gen_ui_text.ts</c>) and generated files hold data, not behaviour. Adding this method
/// there would work until the next regeneration silently deleted it - which is a mistake this
/// repository has already made once, with <c>WorkshopText</c>.
/// </para>
/// <para>
/// A TIER 8 IS NOT THE CARD YOU WERE CARRYING, and the whole point of an ascension is that the
/// reel and the loadout say so. There is drawn art for each of the five - twin mount, chain laser,
/// hornet, giga beam, hydra - and every surface on this front-end was asking for the base card's
/// icon, so a Twin Mount showed the Cannon's single shell and a Hydra showed one beam. They were
/// right before the port; the port lost the tier, not the art.
/// </para>
/// <para>
/// THE LOOKUP GOES THROUGH <see cref="PediaText"/>, where the generated ascension table already
/// lives. A second copy of "which card becomes what" is a second thing to renumber. The web build
/// asks the same question of the catalog itself (<c>upgradeIconAt</c>); this is that question put
/// to the table the port generates from it.
/// </para>
/// </remarks>
public static class CardIcons
{
    /// <summary>
    /// The icon <paramref name="card"/> wears at <paramref name="tier"/>: its own below the
    /// ascension, and the ascension's at or above it.
    /// </summary>
    public static string IconKeyAt(this CardText card, int tier) =>
        tier >= UpgradeCatalog.WeaponAscendedTier && PediaText.AscensionOf(card.Id) is { } asc
            ? "icon_" + asc.Icon
            : card.IconKey;
}
