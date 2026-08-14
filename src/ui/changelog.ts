/**
 * THE CHANGELOG, and the overlay that shows it. Reachable from the pause menu.
 *
 * ---------------------------------------------------------------------------------------------
 * HOW TO ADD AN ENTRY
 * ---------------------------------------------------------------------------------------------
 * Put it at the TOP of `CHANGELOG`, newest first, and stamp it with the commit's own time:
 *
 *     git log -1 --date=format-local:'%Y-%m-%dT%H:%MZ' --pretty=format:'%ad'
 *
 * One entry per change a PLAYER would notice, not one per commit. Refactors, documentation fixes
 * and build plumbing do not belong here; if it did not change what happens on screen or what the
 * numbers do, it is not a change to the game.
 *
 * ---------------------------------------------------------------------------------------------
 * WHY THIS IS A .ts MODULE AND NOT A MARKDOWN FILE
 * ---------------------------------------------------------------------------------------------
 * It has to be readable from inside the running game, and the game has two build targets: the
 * normal split build served from Pages, and the SINGLEFILE build whose host forbids every network
 * request (`connect-src 'none'`). A `fetch('/CHANGELOG.md')` works in the first and silently
 * shows an empty list in the second. Bundled data works in both, and cannot 404.
 *
 * ---------------------------------------------------------------------------------------------
 * TIMES ARE UTC, AND ARE PRINTED AS UTC
 * ---------------------------------------------------------------------------------------------
 * They come from git, which records UTC, and they are rendered verbatim rather than converted to
 * the device's zone. A changelog is a record of when the repository changed, not of when the
 * reader's phone thinks it changed - and rendering through `toLocaleString` would make two people
 * comparing notes on the same build read different timestamps for the same entry.
 */

export interface ChangelogEntry {
  /** ISO 8601, UTC, minute precision: `YYYY-MM-DDTHH:MMZ`. Straight from the commit. */
  readonly at: string;
  readonly title: string;
  /** One line per thing that changed. Player-facing: what it does, not how it was done. */
  readonly notes: readonly string[];
}

/** NEWEST FIRST. See the header before adding to this. */
export const CHANGELOG: readonly ChangelogEntry[] = Object.freeze([
  {
    at: '2026-08-14T10:28Z',
    title: 'Credits are kept between runs',
    notes: [
      'Blue credit coins no longer die with the run. The total banks, shows on the mech picker as “N credits banked”, and keeps climbing every time you play.',
      'The summary reads “+N” for the run you just finished and the lifetime figure beside it.',
      'Nothing spends credits yet. This is the currency the meta-progression will run on, and it is being collected from now so that whatever it buys, you arrive with something.',
    ],
  },
  {
    at: '2026-08-14T10:28Z',
    title: 'There is land beyond the fence again',
    notes: [
      'The ground outside the perimeter used to be a flat black void, which made the yard read as the edge of a level. It is ground now - the same barren rust, dimmed and cooled, running off past the wire.',
    ],
  },
  {
    at: '2026-08-14T10:28Z',
    title: 'Fuel barrels: smaller, everywhere, and sometimes empty',
    notes: [
      'A drum is now comfortably smaller than the mech that walks into it, and no longer an obstacle worth steering around.',
      'There are roughly three times as many of them. A barrel is something you clip on the way past, not a landmark you cross the map for.',
      'One in four holds nothing at all. It still goes up - you just get to see that it was empty.',
    ],
  },
  {
    at: '2026-08-14T09:44Z',
    title: 'Walk into a barrel and it goes over',
    notes: [
      'The mech does not stop for it, and the drop lands where you are already walking - so the pickup usually completes in the same stride.',
      'Weapons break barrels by accident, aiming at something else. Walking into one is the only way to take a barrel on purpose.',
      'Enemies still cannot break them, so the horde will not clear the yard for you on its way past.',
    ],
  },
  {
    at: '2026-08-14T09:13Z',
    title: 'Fuel barrels, and the three things inside them',
    notes: [
      'A lone drum with a hazard band, standing among the scrap. Nothing targets it - the guns will not aim at one - but any weapon that hits it sets it off.',
      'SPANNER: repairs a quarter of your maximum hull.',
      'CREDIT COIN: 1 to 50 credits, worth more the later in the run you find it. The pile you can see is the amount - a single coin, a small stack, a large stack, or an overflowing bag.',
      'MAGNET: every XP gem in the world comes to you for four seconds, at any distance.',
      'Consumables are walked over, not magnetised. Deciding whether to go and get one is the point of them.',
      'Lasers hold fire rather than burning into scenery, so they cook themselves for nothing far less often.',
    ],
  },
  {
    at: '2026-08-14T08:48Z',
    title: 'Wrecked hulls in the yard',
    notes: [
      'Dead enemy vehicles lie burnt and tilted among the scrap - the same hulls you have been shooting all run.',
      'And, rarely, a wrecked MECH: one chassis on its side with a leg torn off and cockpit glass thrown clear. About one in every thirty piles.',
    ],
  },
  {
    at: '2026-08-14T08:41Z',
    title: 'Scrap in the yard, and an endgame that is heavy rather than fast',
    notes: [
      'The ground now has crushed cars, barrel clusters, girder heaps and tyre stacks standing on it. You and the horde both have to go around them; shells bury themselves in them; lasers hold fire rather than burning into them.',
      'Enemies no longer get better at everything every two minutes. Some cycles trade speed for mass and some do the reverse - the Scavenger is quick and flimsy, the Hauler slow and fat, the Prowler the fastest thing in the game, the Dozer the slowest.',
      'THE LAST TWO CYCLES ARE MUCH SLOWER. At fifteen minutes the fastest thing on the field has dropped by more than a fifth. The endgame closes in on you now rather than chasing you down.',
    ],
  },
  {
    at: '2026-08-14T07:56Z',
    title: 'The arena is a fenced scrapyard, not a loop',
    notes: [
      'The world no longer wraps. It is a walled yard about 12 000 units across - a minute to cross at a sprint - with a real perimeter fence you can walk up to and cannot pass. Running into it slides you along it.',
      'Enemies you outrun are picked up and put back in front of you, at the health you left them on. There is no longer any distance at which the horde stops being your problem.',
      'GEMS STAY WHERE THEY FELL. They no longer come back round to you on their own, so going back for the XP you abandoned is a real decision.',
      'Fixed: the gem magnet could fling a gem past you and out through the fence, where it could never be picked up. That XP is no longer lost.',
    ],
  },
  {
    at: '2026-08-14T00:05Z',
    title: 'The arena wraps, and nothing despawns',
    notes: [
      'Run far enough in one direction and you come back where you started. The map is a loop about 4100 units across - roughly twenty seconds at a sprint.',
      'Enemies are never deleted for being outrun. The horde you left behind keeps walking, and it will be in front of you on the next lap.',
      'Gems you abandoned are still there when you come round again.',
      'Bosses can no longer be escaped by running in a straight line, which is why they now actually die: two boss kills in a test run that used to end with none.',
    ],
  },
  {
    at: '2026-08-13T23:30Z',
    title: 'The summary says which weapon was carrying the run',
    notes: [
      'Damage by source, biggest first, with each weapon’s share of the total. The Energy Shield’s backlash gets its own line rather than being folded into a gun.',
      'The same breakdown prints in the headless sim, so a balance pass can see which of five weapons a build actually leaned on.',
    ],
  },
  {
    at: '2026-08-13T23:05Z',
    title: 'Every weapon shows what it is waiting on',
    notes: [
      'The Cannon, both missile racks and Heavy Artillery now carry a rearm bar that fills to full the moment the weapon can fire again, with the rearm time beside it.',
      'The number is the real one: it moves with fire-rate tiers and with chassis bonuses, so Ash reads 2.40s on the Short Missiles where everyone else reads 3.00s.',
      'Nothing on the loadout row is a blank chip any more - a beam shows heat, a magazine shows ammunition, everything else shows rearm.',
    ],
  },
  {
    at: '2026-08-13T22:45Z',
    title: 'The Machine Gun shows its magazine and its reload',
    notes: [
      'The loadout chip now carries a brass ammunition bar that drains as you fire, with the rounds left beside it.',
      'When the magazine runs dry the bar refills through the reload with a countdown, so the longest silence in the game - 15s at tier 1 - stops looking like a broken gun.',
      'It is deliberately not dressed like an overheat: a laser cutting out is a fault and looks like one, a reload is a procedure that is going to finish.',
    ],
  },
  {
    at: '2026-08-13T22:15Z',
    title: 'Plum starts with the shield and nothing else',
    notes: [
      'Plum no longer gets a free opening card. It walks in with the Energy Shield, no weapon, and has to earn its first upgrade like every other chassis - out of kills made by things breaking themselves on the rim.',
    ],
  },
  {
    at: '2026-08-13T22:10Z',
    title: 'Missiles steer, lasers reach further',
    notes: [
      'Short Missiles turn twice as hard and Long Missiles half again as hard. Both racks were landing about one missile in six; they now land closer to one in three, and the Long rack is worth more than twice what it was.',
      'All three lasers gained 10% base reach. The Medium Laser doubles its measured damage from it; the Long Laser was never short of range and is unchanged.',
      'The Short Laser is still the weakest weapon in the game by a wide margin - 10% was not enough, and no laser tier sells range.',
    ],
  },
  {
    at: '2026-08-13T21:55Z',
    title: 'Upgrade cards say which pool at a glance',
    notes: [
      'Weapon cards head in the game’s yellow; passive cards head in the shield’s blue. Weapons and passives compete for separate slots, so which pool an offer comes from is now readable before you read the name.',
    ],
  },
  {
    at: '2026-08-13T20:50Z',
    title: 'Mechs stop being skins',
    notes: [
      'Eight chassis now carry a bonus to one weapon. Slate vents the Medium Laser 50% faster; Moss doubles the Short Laser’s reach; Ember hits 30% harder with the Long Laser; Amber’s Cannon shells punch through one extra body; Onyx fires a fourth Long Missile; Ash rearms the Short Missiles 20% faster; Bone hits 30% harder with the Machine Gun.',
      'A bonus follows the weapon, not the opener: pick that gun up later in a run and you still get it.',
      'Plum walks in with no gun at all, behind an Energy Shield that recharges 60% faster, and picks its opening weapon from the very first card.',
      'Onyx, Ash, Bone and Plum now sit together, fifth through eighth on the select screen.',
      'New app icon.',
    ],
  },
  {
    at: '2026-08-13T20:35Z',
    title: 'Artillery aims, and the two missile racks look different',
    notes: [
      'Heavy Artillery no longer throws a stray missile sprite. A red targeting ring lands on the ground, sized to the blast that is coming, with a second ring closing inward as the fuse burns down - then it explodes.',
      'The ring is the real blast radius, so it visibly widens as the weapon tiers up from 75u to 111u, and the crater matches the circle you were shown.',
      'Short and Long Missiles are now told apart in the air: the short rack is squat and fat, the long rack longer and thinner.',
    ],
  },
  {
    at: '2026-08-13T20:20Z',
    title: 'Onyx takes the Long Missiles',
    notes: [
      'Onyx now opens with the Long Missiles instead of the Short.',
      'Onyx and Ash have moved up the select screen to fifth and sixth; Cobalt takes the slot they left.',
      'Fixed the mech picker forgetting your choice whenever you picked one of the last eight chassis - it always reopened on Brass.',
    ],
  },
  {
    at: '2026-08-13T20:05Z',
    title: 'New passive: Energy Shield',
    notes: [
      'A blue rim around the mech absorbs one hit outright, whatever its size, then breaks and recharges after 20s.',
      'Breaking a rim also makes you immune for a moment, so a crowd that all reach you at once spends its whole bite on the one layer.',
      'The field discharges into whatever broke it. Enough to knock over a first-cycle Rustling outright; a Scavenger one cycle later walks away from it.',
      'Seven tiers: three cut the recharge to 9s, two extend the immunity to 0.2s, and the last adds a second rim that recharges in its own right.',
      'It is the opposite trade to Ablative Plate - armour is worth the same against a nibble and a boss slam, a rim is worth the whole hit - and there are now six passives competing for five slots.',
    ],
  },
  {
    at: '2026-08-13T19:15Z',
    title: 'Changelog in the pause menu',
    notes: [
      'Pause now has a Changelog button listing every change to the game, newest first, with the date and time it landed.',
    ],
  },
  {
    at: '2026-08-13T18:58Z',
    title: 'Public playtest link',
    notes: [
      'The game is published to a public URL that always serves the latest build, so a link shared once never goes stale.',
      'Every push runs the typecheck, the unit tests and a full headless simulation before it can reach the link.',
    ],
  },
  {
    at: '2026-08-13T18:55Z',
    title: 'Only Heavy Artillery has a blast radius',
    notes: [
      'The Cannon lost its splash. It commits to the highest-HP enemy in range and now leaves everything else standing, so a crowd is a problem for a different weapon to solve.',
      'Both missile racks lost their splash. A missile damages exactly the body it strikes, and a missile that misses now simply misses.',
      'Heavy Artillery is unchanged and is the only area weapon left: a 75u blast at tier 1, growing to 111u at tier 7.',
    ],
  },
  {
    at: '2026-08-13T18:09Z',
    title: 'Lasers burn through instead of holding fire',
    notes: [
      'A laser used to refuse the shot entirely when anything stood between it and its target. It now fires and burns whatever is in the way.',
      'Aim and impact are separate: the weakest enemy decides where the beam points, and the first body on the line takes the damage.',
      'Fixed a bug where a beam fired straight over the top of anything pressed against the mech. Measured standing in a crowd, the Short Laser went from 0.4 to 20.7 damage per second.',
    ],
  },
  {
    at: '2026-08-13T17:49Z',
    title: 'Health bars mean rank',
    notes: [
      'Elites and bosses always show a health bar; regular enemies never do. It used to depend on which chassis the enemy happened to be built on, so a weaker enemy could show a bar while a tougher one did not.',
    ],
  },
  {
    at: '2026-08-13T17:37Z',
    title: 'Level-ups heal',
    notes: [
      'Every level gained restores 5% of maximum hull - per level, so a boss core that crosses three thresholds at once pays out three times.',
      'This is the only healing in the game, so how much damage you can take between level-ups is the whole attrition budget.',
    ],
  },
  {
    at: '2026-08-13T17:23Z',
    title: 'Enemies slowed by 12%',
    notes: ['Every cycle in the enemy ladder moves one step slower. Ranks are unchanged, so elites and bosses stay slower still.'],
  },
  {
    at: '2026-08-13T17:22Z',
    title: 'The mechs walk',
    notes: [
      'Every chassis has a four-frame walk cycle driven by distance travelled, so the legs stop when you stop and keep up when you sprint.',
      'The hover chassis pulse their lift skirts and flicker their nozzles instead, and keep moving while standing still.',
      'The chassis rocks slightly as weight shifts onto the planted foot, and the turret recoils when a weapon fires.',
    ],
  },
  {
    at: '2026-08-13T16:40Z',
    title: 'Sixteen mechs',
    notes: [
      'Eight new chassis, so all sixteen are visually distinct: four leg styles, six weapon mounts, four torso shapes and two weight classes, and no two share a silhouette.',
      'Every weapon is now somebody’s opener, with two chassis each - one light, one heavy.',
    ],
  },
  {
    at: '2026-08-13T13:44Z',
    title: 'New player art, and the hero previews come back',
    notes: [
      'The mechs are drawn as walkers rather than the tracked robots they were - legs, shoulder pods and forward-projecting barrels.',
      'Fixed the hero-select grid showing eight blank tiles in the shared build.',
    ],
  },
  {
    at: '2026-08-13T13:27Z',
    title: 'The 120-second enemy cycle',
    notes: [
      'The run is now a repeating cycle: one minute of a single enemy, thirty seconds with elites added, thirty seconds with a boss added, then a new and tougher enemy.',
      'Elites and bosses are recoloured versions of that cycle’s own enemy - same shape, different paint, much more health. Bosses carry a blue outline.',
      'Nothing is cleared at a rollover. Anything you ran away from is still out there.',
    ],
  },
  {
    at: '2026-08-13T12:43Z',
    title: 'Five weapons, five passives',
    notes: [
      'A mech carries at most five weapons and five passives; once full, no new ones are offered.',
      'Five passives added, each with seven tiers that pay more at the top than the bottom: Targeting Optics, Ordnance, Feed Systems, Servo Drive and Ablative Plate.',
    ],
  },
  {
    at: '2026-08-13T12:05Z',
    title: 'Laser retune',
    notes: [
      'The Short Laser now has the highest sustained damage of the three, and all three spend more time cooling.',
    ],
  },
  {
    at: '2026-08-13T11:39Z',
    title: 'Heavy Artillery',
    notes: [
      'The eighth weapon: three shells fall on random ground nearby after a short fuse. It aims at nothing and nobody, and the blast is the whole weapon.',
    ],
  },
  {
    at: '2026-08-13T11:20Z',
    title: 'Machine Gun',
    notes: [
      'Very short range, two rounds at a time at the weakest enemy, very low damage, very high rate of fire.',
      'It runs on a 200-round magazine and a fifteen-second reload - the third kind of limiter in the game, after cooldowns and heat.',
    ],
  },
  {
    at: '2026-08-13T11:07Z',
    title: 'Two missile racks',
    notes: [
      'Short Missiles: two missiles fifteen degrees apart, fired along your last direction of travel, homing weakly toward whatever is nearest to them.',
      'Long Missiles: three missiles ten degrees apart, weaker homing, longer flight, slower rearm.',
    ],
  },
  {
    at: '2026-08-13T09:57Z',
    title: 'Every hero opens with a different weapon',
    notes: ['Your starting gun is the reason to pick a chassis, and it starts at tier 1 of its own ladder.'],
  },
  {
    at: '2026-08-13T09:55Z',
    title: 'Enemies slowed',
    notes: ['Every enemy is about a fifth slower, so the horde closes at a pace you can read.'],
  },
  {
    at: '2026-08-13T09:53Z',
    title: 'Seven-tier weapon ladders',
    notes: [
      'Upgrades are now weapons only, each with seven tiers: an unlock, then six that alternate between hitting harder and running longer.',
      'Passives removed for now; they come back later.',
    ],
  },
  {
    at: '2026-08-13T09:07Z',
    title: 'The three lasers',
    notes: [
      'Short, Medium and Long Lasers: a drawn beam onto the weakest enemy in range, stopping at the first body it touches.',
      'Heat replaces the cooldown. Firing heats the emitter; at capacity it cuts out and stays out until it has cooled halfway.',
    ],
  },
  {
    at: '2026-08-13T08:28Z',
    title: 'Loading fixed',
    notes: [
      'Fixed the game hanging on a blank loading screen in sandboxed embeds.',
      'The loading bar shows real progress instead of sitting at zero.',
    ],
  },
  {
    at: '2026-08-13T08:19Z',
    title: 'The Cannon’s targeting rule earns its keep',
    notes: [
      'Shooting the highest-HP enemy used to leave the chaff untouched. The Cannon hits harder and its blast finished what the shell started.',
    ],
  },
  {
    at: '2026-08-12T22:28Z',
    title: 'First playable',
    notes: [
      'One mech, one Cannon, a horde that never stops, and fifteen minutes to survive.',
      'The Cannon fires at the highest-health enemy in range: medium range, slow rate of fire, heavy damage.',
    ],
  },
  {
    at: '2026-08-12T16:26Z',
    title: 'Project started',
    notes: ['Scrapyard begins.'],
  },
] as const) as readonly ChangelogEntry[];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * `2026-08-13T18:55Z` -> `13 Aug 2026 · 18:55 UTC`.
 *
 * Parsed by hand rather than through `Date`: the string is already the exact instant we want to
 * show, and routing it through a Date only creates opportunities to shift it by a timezone.
 * A malformed stamp renders as itself rather than as `Invalid Date`.
 */
export function formatChangelogTime(at: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})Z$/.exec(at);
  if (m === null) return at;
  const month = MONTHS[Number(m[2]) - 1] ?? m[2];
  return `${Number(m[3])} ${month} ${m[1]} · ${m[4]}:${m[5]} UTC`;
}

export interface ChangelogOverlay {
  readonly element: HTMLDivElement;
  show(): void;
  hide(): void;
}

/**
 * Built ONCE at boot and reused, like every other overlay: the list never changes at runtime, and
 * rebuilding twenty-odd entries inside a phase transition is exactly when a dropped frame shows.
 */
export function buildChangelogOverlay(onBack: () => void): ChangelogOverlay {
  const el = document.createElement('div');
  el.className = 'overlay changelog';
  el.hidden = true;
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'Changelog');

  const head = document.createElement('div');
  head.className = 'changelog__head';
  const title = document.createElement('h2');
  title.className = 'changelog__title';
  title.textContent = 'Changelog';
  const sub = document.createElement('div');
  sub.className = 'changelog__sub';
  sub.textContent =
    CHANGELOG.length > 0 ? `Latest: ${formatChangelogTime(CHANGELOG[0].at)}` : 'No entries yet';
  head.append(title, sub);

  const list = document.createElement('div');
  list.className = 'changelog__list';

  for (const entry of CHANGELOG) {
    const item = document.createElement('section');
    item.className = 'change';

    const when = document.createElement('div');
    when.className = 'change__when';
    when.textContent = formatChangelogTime(entry.at);

    const name = document.createElement('div');
    name.className = 'change__name';
    name.textContent = entry.title;

    item.append(when, name);

    if (entry.notes.length > 0) {
      const notes = document.createElement('ul');
      notes.className = 'change__notes';
      for (const note of entry.notes) {
        const li = document.createElement('li');
        li.textContent = note;
        notes.appendChild(li);
      }
      item.appendChild(notes);
    }

    list.appendChild(item);
  }

  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'btn btn--primary changelog__back';
  back.textContent = 'Back';
  back.addEventListener('click', onBack);

  el.append(head, list, back);

  return {
    element: el,
    show(): void {
      el.hidden = false;
      // Always open at the newest entry, however far the last visit scrolled.
      list.scrollTop = 0;
    },
    hide(): void {
      el.hidden = true;
    },
  };
}
