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
    at: '2026-08-19T06:54Z',
    title: 'THE HORNET, SHARPENED',
    notes: [
      'The short missiles a Hornet warhead splits into now corner noticeably harder — a child born pointing the wrong way comes around in time to matter.',
      'Once the Hornet stands, the deck stops offering both missile racks for the rest of the run. The freed slot is for something new, not for climbing the same ladder twice.',
    ],
  },
  {
    at: '2026-08-19T08:19Z',
    title: 'HOT EMITTERS SIT WHERE THE GUNS ARE',
    notes: [
      'A laser\u2019s heat glow and the sputter it makes when it cuts out now sit on the emitter that is actually straining \u2014 the shoulder or nose mount the beam leaves from \u2014 instead of floating out in front of the chassis. Second and third lasers were the worst offenders: theirs could end up hanging in open ground nowhere near the mech.',
    ],
  },
  {
    at: '2026-08-19T07:29Z',
    title: 'A FOURTH ASCENSION EXISTS',
    notes: [
      'Somewhere past tier seven, one of the weapons you know can become something else again. What it takes and what it becomes is yours to find — the Scrapopedia counts one more silhouette.',
    ],
  },
  {
    at: '2026-08-19T07:03Z',
    title: 'THE SIEGE REMEMBERS WHERE YOU WERE',
    notes: [
      'Siege Heavies no longer track you as you move. The whole ring converges on the spot you were standing when it closed, for a full minute and a half — stand your ground and it is a tightening noose; step out of it and it becomes a slow grey knot forming on the yard where you used to be. When the time is up, the mass turns and comes for you after all.',
    ],
  },
  {
    at: '2026-08-19T06:44Z',
    title: 'THE HORNET BREAKS EARLIER',
    notes: [
      'The GTM Hornet’s warheads now split a touch sooner after launch, so the ten-missile cloud forms closer to you — right where the crowd is pressing in, instead of out at the volley’s far end.',
    ],
  },
  {
    at: '2026-08-19T06:38Z',
    title: 'NEW PASSIVE: SHAPED CHARGES',
    notes: [
      'A new passive for the demolition builds: every blast reaches wider — the artillery barrage, a drone going out, the burst on a phase bolt. The deck only offers it while you hold something that explodes.',
      'It starts locked, behind 2000 kills with blast damage counted across your whole career — and yes, its sealed achievement carries the third unlabeled progress bar.',
    ],
  },
  {
    at: '2026-08-19T06:38Z',
    title: 'HEAVIER MOUNTS, FASTER WALLS',
    notes: [
      'The Cannon and Machine Gun turrets traverse 10% slower — a crowd forming behind you costs that little bit more barrel time.',
      'Heavy bodies walk 10% faster again. The wall keeps coming.',
    ],
  },
  {
    at: '2026-08-19T06:30Z',
    title: 'TIER 8: THE CANNON BECOMES THE TWIN MOUNT',
    notes: [
      'The third ascension. The second barrel comes back, and every shot is two full shells side by side — aimed together as their midpoint, flying parallel, each hitting whatever its own line meets. A wide body centred on the line takes both; a runt just off it catches one, so where you stand still decides what the pair is worth.',
      "The Cannon's drawn turret is a single barrel now, tiers one through seven — the twin-barrel mount you know is the ascension's, worn from the moment it lands. How a tier 8 arrives is the same as it has always been, and finding this one's build is the game.",
    ],
  },
  {
    at: '2026-08-19T05:53Z',
    title: 'TURRETS YOU CAN BELIEVE',
    notes: [
      'The mech no longer wears a barrel it has no gun for. Three weapons have a drawn turret now — the Cannon\'s full twin mount, the Phase Cannon\'s shorter plasma tube, the Machine Gun\'s stubby snout — each appearing only while that gun is aboard, each tracking and recoiling for its own shots. Hold all three and they stack, three mounts swinging at three targets.',
      'Everything else fires from where it actually lives: the racks, drums and spine tubes baked into the chassis, the sky, or the drones themselves. A chassis with none of the three shows no turret at all — which also retires the barrel that gunless Plum used to carry around pointing wherever it walked.',
    ],
  },
  {
    at: '2026-08-19T05:53Z',
    title: 'LASERS FIRE FROM REAL HARDPOINTS',
    notes: [
      'Beams now leave the mech from mounted emitters instead of the middle of the sprite: one laser fires from the nose, a pair fires from the two shoulders, three light up all three mounts. The mounts turn with the chassis, so which shoulder faces the fight is now something you steer.',
      'The hardpoint is the true origin, not a decoration — the beam\'s reach and what blocks it are measured from the emitter itself, so a beam reaches a touch further ahead of its mount and a touch shorter behind it.',
    ],
  },
  {
    at: '2026-08-17T20:01Z',
    title: 'THE TURRET ONLY RECOILS FOR ITS OWN SHOTS',
    notes: [
      "The drawn barrel used to kick back — and the camera with it — whenever any of your guns fired, so a chassis with a slow main gun looked like it was firing constantly the moment you picked up missiles or a machine gun. Brass's Phase Cannon made it obvious: the tube jerked on every missile volley it had nothing to do with. Recoil and shake now belong to the gun the barrel actually draws.",
    ],
  },
  {
    at: '2026-08-17T18:51Z',
    title: 'A SECOND MYSTERY BAR',
    notes: [
      'Another sealed achievement in the Scrapopedia now carries the thin unlabeled bar. Same rules as the first: no caption, no numbers, and whatever it is counting no longer resets when a run ends.',
    ],
  },
  {
    at: '2026-08-17T17:58Z',
    title: 'A LOCKED ACHIEVEMENT WITH A PROGRESS BAR',
    notes: [
      "There is a new sealed achievement in the Scrapopedia, and under its name sits a thin unlabeled bar. It won't tell you what it's counting — nothing in this game states a condition before you've met it — but it moves, and what you did last run decides how much. Working out what makes it climb is the puzzle.",
    ],
  },
  {
    at: '2026-08-17T17:53Z',
    title: 'WEAPON KILL UNLOCKS COUNT ACROSS RUNS',
    notes: [
      "The Phase Cannon's 1001 kills now accumulate over your whole career instead of resetting with every run. Kills are banked while you play, once a second — so a run that ends in a tab reload keeps what it earned, and the card unlocks the moment the lifetime tally crosses the line, mid-run included.",
    ],
  },
  {
    at: '2026-08-17T17:38Z',
    title: 'NEW WEAPON: THE PHASE CANNON',
    notes: [
      'A blue plasma bolt that aims at the enemy with the thickest crowd packed around it — even one behind a wall — and flies through everything on the way: the horde, the wrecks, the walls. Nothing in between is touched; the mark takes the bolt and everything around it takes the burst.',
      'The price is the slowest turret in the yard. The bolt cannot miss once fired, so the fight is getting the barrel around in time.',
      'Its card is locked until you have destroyed 1001 enemies with the gun in one run — which sounds circular until you meet the chassis below.',
    ],
  },
  {
    at: '2026-08-17T17:38Z',
    title: 'BRASS CAN NOW BE EARNED, AND CARRIES THE PHASE CANNON',
    notes: [
      'Brass has a real unlock condition at last — where it is stated is where they always are, on the achievement, after you have met it. It opens with the Phase Cannon, 10% harder-hitting, and is the only way to fire one before its card is earned.',
      "Its cockpit glass runs plasma-blue now instead of the Cannon's amber, because the chassis says what it opens with before the first shot.",
    ],
  },
  {
    at: '2026-08-17T16:32Z',
    title: 'INDIGO CAN NOW BE EARNED',
    notes: [
      'The artillery chassis has a real unlock condition at last, and its own achievement to go with it. What the condition is stays where it always does — on the achievement, after you have met it.',
      'It flies its own flag now too: its Heavy Artillery blasts 15% wider than anyone else firing the same tube. And it has moved up the roster to sit beside Fern, out of the block of silhouettes still waiting for their criteria.',
    ],
  },
  {
    at: '2026-08-17T16:32Z',
    title: 'NEW IN THE WORKSHOP: BURSTING CHARGES',
    notes: [
      'Three tiers, 70 credits each, +10% blast radius apiece — +30% at full. It widens everything that explodes: the artillery barrage and the blast a drone goes out on. Nothing else blasts, so nothing else changes.',
    ],
  },
  {
    at: '2026-08-17T16:32Z',
    title: 'A RETUNED WORKSHOP UPGRADE REFUNDS ITSELF',
    notes: [
      'From now on, if a workshop upgrade you own is ever rebalanced — its price, its tiers, or what a tier does — your purchase is automatically refunded at the price you actually paid, the next time the game loads. You keep your credits; nobody gets silently moved onto a deal they never agreed to.',
    ],
  },
  {
    at: '2026-08-17T16:14Z',
    title: "INDIGO'S SILHOUETTE NOW MATCHES ITS GUN",
    notes: [
      "Indigo opens with the Heavy Artillery but was drawn carrying a boxed missile rack — leftover art from before it was moved onto that weapon. It now carries the howitzer tube its gun actually is, on the picker's silhouette as well as everywhere else.",
    ],
  },
  {
    at: '2026-08-17T15:18Z',
    title: 'THREE PASSIVE ICONS REDRAWN',
    notes: [
      "Ordnance and Feed Systems used to wear the same arrow, one arrow and two of it, which made them hard to tell apart at a glance on the level-up card or a spinning chest reel. Ordnance is now a four-point impact burst and Feed Systems a fast-forward arrow — two different pictures for two different cards.",
      "Energy Shield's ring used to read as a stray letter C. It is now a tighter ring studded with sparking energy nodes, closer to what the shield actually looks like around the mech.",
    ],
  },
  {
    at: '2026-08-17T13:43Z',
    title: 'NEW PASSIVE: RADIATOR BANK',
    notes: [
      "A new laser-only passive: a bigger heat buffer and faster shedding between bursts on every beam you hold. It won't show up on the level-up card unless you're already holding a laser, and it starts locked — run all three lasers red-hot at once in one run to earn it.",
    ],
  },
  {
    at: '2026-08-17T13:17Z',
    title: 'HEAVY BODIES ARE 50% FASTER',
    notes: [
      "The Heavy in a siege ring walked slowly enough that you could simply leave, deal with the rest of the horde, and come back to find it barely moved. It's noticeably quicker now — still a wall you have to grind down or go around, but no longer one you can outrun by standing still.",
    ],
  },
  {
    at: '2026-08-17T13:17Z',
    title: 'THE GTM HORNET SPLITS SOONER',
    notes: [
      'Its missiles now break into their short-range pair earlier in flight, so the second wave forms while the volley is still opening out instead of near the end of its run — more of the spread lands in the crowd where it counts.',
    ],
  },
  {
    at: '2026-08-17T12:50Z',
    title: "BONE'S BONUS NO LONGER REACHES DRONES",
    notes: [
      "Bone's card says \"Machine Gun, 30% harder-hitting\" — and because a drone fires that same gun's numbers internally, the bonus was quietly reaching every drone too, on a chassis whose card never mentions them. Fixed: the bonus now stays on the weapon it names.",
    ],
  },
  {
    at: '2026-08-17T12:42Z',
    title: 'FEWER SHEEP',
    notes: [
      'The flock on Mossy Mayhem was three times as thick as the Scrapyard\'s own fuel drums for the same amount of ground — it shipped as a guess and the guess was too generous. Matched to the real drum count now, so the two maps hand out loot at about the same rate.',
    ],
  },
  {
    at: '2026-08-17T11:45Z',
    title: 'DRONES DO LESS DAMAGE PER ROUND',
    notes: [
      'Drones were the strongest weapon in the game by a wide margin — a full fleet is four machine guns firing at once, and that added up to more than a run holding one gun could keep pace with. Each round now hits for less.',
      'They are still the single strongest weapon at tier 7. This closes most of the gap rather than all of it — build a bay and it is still the pick that carries a run.',
    ],
  },
  {
    at: '2026-08-17T10:53Z',
    title: 'LASERS ARE STOPPED BY TREES NOW — AND CUT THEM DOWN',
    notes: [
      'A beam used to pass straight through a clump of trees and burn the thing on the far side, so a laser build fought as though the wood was not there. It now stops in the wood and spends every second of that burn on it: hold the beam on a treeline and it comes down, then the beam reaches whatever was behind it.',
      'Trees still never make a weapon hold fire — that is what stone and scrap do. Your guns keep shooting at whatever they were aiming at, and the wood in the way pays for it, which eventually opens the way through. Measured: the Long Laser used to fell 16 stems in two minutes and open one gap; it now fells 71 and opens 13.',
    ],
  },
  {
    at: '2026-08-17T10:41Z',
    title: 'THERE ARE SHEEP IN THE MOSS',
    notes: [
      'Mossy Mayhem finally has what the Scrapyard has always had: something to break open for a spanner, a magnet or a handful of credits. Here it is a flock, and it does not stand still.',
      'A sheep grazes, wanders off at its own pace, and drifts away from anything near it. Get close and it bolts — not fast enough to escape a mech that means it, which is the whole deal: the loot costs you the seconds you spend cornering one.',
      'They hold exactly what a fuel drum holds, and they come apart the same four ways: a shell, a blast, a beam sweeping past, or you walking into one. Your guns are not aiming at them — as with drums, you break them by accident on the way to something else.',
      'The flock fills in ahead of you as you cross the map, so wherever you go there are sheep over the next rise.',
    ],
  },
  {
    at: '2026-08-17T10:16Z',
    title: 'MOSSY MAYHEM HAS TO BE EARNED',
    notes: [
      'The second yard starts LOCKED. Clear the Scrapyard — every Scraplord down, not merely survive it — and it opens, with a trophy to say so.',
      'It is the first thing in the game behind a win rather than behind something that happens on the way to losing. The card keeps its name so you know it is there; what it takes is not written anywhere until you have done it.',
      'If you have already beaten the Scrapyard on this save, your next win will open it — the game only learns what a run did when the run ends.',
    ],
  },
  {
    at: '2026-08-17T10:01Z',
    title: 'THE GAME NOW TELLS YOU HOW TO WIN IT',
    notes: [
      'The title screen said "Fifteen minutes. One yard." Outlasting the clock has never been the win condition — you win when the timer has passed AND every Scraplord is dead — and the run is sixteen minutes, and there are two yards. It now says what it actually takes.',
      'The Scrapyard\'s own description was wrong in both numbers too: sixteen minutes and eight bosses, not fifteen and seven. Both are now read off the game rather than typed in, so they cannot drift again.',
    ],
  },
  {
    at: '2026-08-17T09:49Z',
    title: 'BEING SAVED NOW STOPS THE GAME',
    notes: [
      'When Mech Insurance pulls you out of a death, everything holds still for a moment. The screen shakes, the hull comes back together in a gold flash, a second shockwave sweeps out past the crowd, and the words say what happened — then the fight resumes exactly where it stopped.',
      'It used to be a flash in the middle of a fight you were losing, at the one instant you were least able to notice it. The most expensive thing in the workshop should be impossible to miss when it pays out.',
      'Nothing about the save itself changed: same full hull, same brief window of being untouchable, still once per run. The frozen moment costs no run time.',
    ],
  },
  {
    at: '2026-08-17T09:25Z',
    title: 'THE HORNET COMES APART SOONER',
    notes: [
      'GTM Hornet warheads now split half a second after launch instead of a full second. The cloud of ten forms while the volley is still opening out, so the second wave arrives in the crowd near you rather than out at the edge of its reach.',
    ],
  },
  {
    at: '2026-08-17T09:06Z',
    title: 'DRONES LAUNCH FROM THE MECH',
    notes: [
      'A new drone now appears at your feet and flies out to its station, instead of blinking into existence already on the escort ring. The bay is on your chassis, so that is where drones come from.',
    ],
  },
  {
    at: '2026-08-17T09:06Z',
    title: 'HEAVIES WALK FASTER',
    notes: [
      'The armoured hulks that show up in a siege ring move a fifth quicker. The ring still takes a while to close on you, but leaving it behind and coming back to find it barely moved no longer works.',
    ],
  },
  {
    at: '2026-08-17T08:47Z',
    title: 'EIGHT BOSSES IS ALL THERE IS',
    notes: [
      'The eighth boss is the last one. A run that goes long past the timer no longer gets handed a fresh boss every two minutes on top of the ones already standing — the waves keep coming, the bosses do not.',
      'Nothing kills a boss but you, so the old behaviour meant a run that let one slip could never be won: there was always another arriving. Survive the eight and the field can only get lighter.',
    ],
  },
  {
    at: '2026-08-17T08:23Z',
    title: 'TREES HAVE TO BE CUT DOWN NOW',
    notes: [
      'A clump of trees no longer disappears the instant something touches it. Each tree in it has its own hit points, and they come down ONE AT A TIME — so a treeline under fire visibly thins, and the gap opens on the near side where you have been shooting.',
      'A whole tile of trees is worth roughly what an elite is. Chewing a hole through woodland is something you spend real firepower on.',
      'Your mech can still shove its way through by leaning on one, and it now takes about four and a half seconds of standing still to do it. Walking past no longer flattens a tree for free.',
    ],
  },
  {
    at: '2026-08-17T08:06Z',
    title: 'THE TROPHY SHELF HAS PICTURES ON IT',
    notes: [
      'Achievements you have earned now show their own icon in the Scrapopedia — the chassis you unlocked, the weapon you turned into something else.',
      'Ones you have not earned show a sealed plate instead. The picture is part of the prize: several of these icons would tell you exactly what you are looking for, and finding out is the game.',
    ],
  },
  {
    at: '2026-08-17T05:04Z',
    title: 'THERE IS A SECOND ASCENSION',
    notes: [
      'A weapon in this game can now become something else for a second time. Finding it is the point, so that is all that will be said here — except that the first one was not the only one, and this one asks for more than a card.',
      'The Scrapopedia will hold its page once you have held it.',
    ],
  },
  {
    at: '2026-08-17T04:45Z',
    title: 'THE JELLY AND THE OOZE HEAVE ALONG',
    notes: [
      'The jelly and the ooze now move like something soft moving under its own weight — squashing as they go and rolling side to side. It is the same motion the Sporeling has, and it turns out to suit a blob better than it suits a mushroom.',
      'The Vine Stalker walks in TWO FRAMES, on purpose. It snaps between one pose and the other with nothing in between — the way a sprite walked before anybody could afford more frames. Everything else on the moss moves smoothly; this one stomps.',
    ],
  },
  {
    at: '2026-08-17T04:04Z',
    title: 'THE MOSS STOPS WALKING BACKWARDS',
    notes: [
      'Every creature on Mossy Mayhem was facing the wrong way — coming at you tail first, in both directions. The Draconian was the one you could not miss, because it is the biggest thing on that map with a face, but the jackals, the hounds, the dragons, the hydra and the flies were all doing it too.',
      'They now face the way they are walking. Nothing on the Scrapyard changes; its machines were always right.',
    ],
  },
  {
    at: '2026-08-17T03:32Z',
    title: 'THE SCRAPOPEDIA REMEMBERS AGAIN',
    notes: [
      'Bestiary pages you unlock by killing something now survive closing the game. They were being thrown away every time it loaded — you would unlock a page, see it, come back later and find it locked again. Everything else in the save was fine; it was only the creature pages.',
      'Pages you have already earned will come back as you meet those enemies again. There is no way to recover what was lost, because it was never written down.',
    ],
  },
  {
    at: '2026-08-17T03:29Z',
    title: 'THE MOSS HAS A WOOD IN IT',
    notes: [
      'The trees on Mossy Mayhem are a WOOD now instead of a row of stamps. Where there used to be one big tree per square there is a clump of smaller ones standing at slightly different places, so a treeline has a ragged edge and no two stretches of it look the same.',
      'Scrub grows at the foot of every clump, hiding the line where trunks used to sit on bare moss.',
      'And all of it SWAYS. Every clump moves on its own timing, so a wood breathes rather than marching in step.',
      'It still blocks exactly what it always blocked, and one hit still fells a whole square — what changed is what you are looking at, not what you can drive through.',
    ],
  },
  {
    at: '2026-08-16T21:16Z',
    title: 'THE TURRET STOPS FLINCHING AT YOUR DRONES',
    notes: [
      'Your mech\'s gun no longer recoils, and the camera no longer shakes, every time a drone fires. A fleet of four running a machine gun was holding the turret jammed back against its mount for the whole run.',
      'The drones still flash at the muzzle when they shoot. It is only the chassis that has stopped reacting to a shot that was not fired from it.',
    ],
  },
  {
    at: '2026-08-16T21:12Z',
    title: 'EVERY GUN HAS ITS OWN COLOUR NOW',
    notes: [
      'The weapon bars along the top used to be four identical greys and three lasers. Every weapon has its own colour: the Cannon is yellow, the Drones are white, the two missile racks are orange and violet, and the artillery is rose. You can find a gun on the row without reading it.',
      'Each bar sits on its own backing, so the numbers and names are legible over grass as well as rust — they were washed out over the moss.',
      'The countdown moved onto the bar itself, which gave the name the whole width underneath. No more DRON… and CANN… — the row spells things out.',
      'The missile racks are now labelled SRM and LRM. They both used to read the same word as a laser: two chips saying SHORT and two saying LONG.',
    ],
  },
  {
    at: '2026-08-16T21:02Z',
    title: 'THE CHEST SAYS WHERE IT LEAVES YOU',
    notes: [
      'Every line of a Cyber Chest payout now says which tier it takes that system up to. A chest that hands you three of the same gun counts up — tier 3, tier 4, tier 5 — instead of naming it three times and leaving you to work out where you landed.',
      'A line that finishes a system is marked MAX, and one that puts something new in your hands is marked NEW.',
    ],
  },
  {
    at: '2026-08-16T19:46Z',
    title: 'THE RIG COMES EARLY NOW',
    notes: [
      'Minute 8 to 10 is the HARDHEAD — the heavy rig that used to close out a run, arriving four cycles sooner. It is as slow and as bitey as the wave it replaces, but it is a much wider body and it barely moves when you hit it.',
      'The last two minutes are the DOZER, the boxy gun-truck. It still has more hit points than anything else in the yard and it is still the slowest thing on the field, but it is a smaller body than the wall that used to stand there — so the end of a run can be shoved around in a way it could not before.',
      'Neither one is tougher or weaker than what stood in its place: every wave keeps its own hit points, speed, bite and salvage. What changed is which machine is wearing them.',
    ],
  },
  {
    at: '2026-08-16T19:37Z',
    title: 'THE BAY WORKS FASTER',
    notes: [
      'Drones build a second quicker. The cut carries all the way up the ladder, so a bay that has been upgraded gains more than a second — and a fleet that gets torn up in a dense wave comes back sooner.',
    ],
  },
  {
    at: '2026-08-16T17:09Z',
    title: 'BIG THINGS TAKE LONGER STEPS',
    notes: [
      'A big Sporeling now walks at a big Sporeling\'s pace. The stride slows as the creature gets larger — an elite is noticeably heavier-footed than a runt, and a boss lumbers — instead of every size scurrying at the same cadence.',
    ],
  },
  {
    at: '2026-08-16T16:54Z',
    title: 'THE BOSS IS OUTLINED, NOT SMUDGED',
    notes: [
      'Bosses in the moss now carry a clean blue outline that traces their shape — through the gap between a Sporeling\'s legs, round every horn on a hydra. It used to be a thick black smear that pooled under the feet and filled in the gaps, and the bigger the boss the more of it there was.',
      'The outline moves with the boss. A walking one no longer swells and shrinks inside a halo that stayed still.',
    ],
  },
  {
    at: '2026-08-16T16:19Z',
    title: 'THE SPORELINGS HAVE LEARNED TO WALK',
    notes: [
      'Sporelings now bob and lean as they come at you instead of sliding along upright. Their feet stay on the ground; the cap rolls with each stride, and no two in a pack are in step with each other.',
    ],
  },
  {
    at: '2026-08-16T14:22Z',
    title: 'THEY DO NOT ALL COME THE SAME WAY',
    notes: [
      'Enemies routing around a wall now spread across every way round that works instead of filing through one gap in single file. Some flank wide, some cut close, and a pack meeting a long wall will often break around both ends of it at once.',
      'Every one of those routes still gets them to you — none of them wander or give up. What changed is that there is more than one.',
      'Cut down a tree and the horde uses the new gap immediately, instead of taking up to half a second to notice it had opened.',
    ],
  },
  {
    at: '2026-08-16T13:49Z',
    title: 'THE WALL WALKS FASTER',
    notes: [
      'Heavies — the grey wall of bodies a siege closes on you with — move a fifth faster. The ring still takes its time, but leaving and coming back no longer finds it almost exactly where you left it.',
    ],
  },
  {
    at: '2026-08-16T13:46Z',
    title: 'THE HORDE KNOWS THE WAY',
    notes: [
      'Enemies now take a route to you rather than feeling their way along whatever they bumped into. Walls are something they walk around, not something they get caught on.',
      'A walled room is no longer a fort. Stand inside one and the whole horde comes round the outside and in through the door — all of them, not the lucky few that guessed the right way.',
      'Enemies you cannot see are finding their way too, so the pressure from behind a treeline arrives instead of quietly never turning up.',
      'They still walk straight at you in the open. Nothing has become clever about hunting you down — only about not getting stuck.',
    ],
  },
  {
    at: '2026-08-16T12:57Z',
    title: 'THE HORDE FINDS ITS WAY IN',
    notes: [
      'Enemies no longer queue up outside a walled room you are standing in. They follow the outside of it until they find the entrance, and they come in.',
      'Nothing gets permanently wedged in a corner any more. A body that has gone the wrong way round something will try the other way rather than standing there for the rest of the run.',
    ],
  },
  {
    at: '2026-08-16T12:31Z',
    title: 'WALLS NOW BEHAVE LIKE WALLS',
    notes: [
      'The horde walks AROUND a wall instead of piling up against it. They pick a side, follow the wall until they are past it, and a pack meeting a wall head-on splits and comes round both ends.',
      'Your shots no longer fly straight through solid rock. A round buries itself in the wall it hits, so cover is cover in both directions.',
      'Your guns stop aiming at things they cannot hit. A target behind a wall is no longer chosen, so the lasers keep burning something they can see instead of locking onto a body through solid rock and holding fire.',
      'That last one applies to the Scrapyard too: weapons no longer pick a target on the far side of a wreck.',
    ],
  },
  {
    at: '2026-08-16T12:14Z',
    title: 'MOSSY MAYHEM HAS WALLS NOW',
    notes: [
      'The moss is no longer open turf. Stone walls run across it in lines, corners, junctions and walled rooms with a way in — cover to fight behind, and corners to lose a pack around.',
      'A gap one segment wide is exactly wide enough to drive through. Every wall is built so that there is always a way past.',
      'Some of it is woodland instead of stone, and woodland comes down. Shoot a tree or simply walk your mech into it and it falls, leaving a stump and a hole in the treeline you can drive through for the rest of the run.',
      'Lasers will not fire into a rock face, but they will burn straight through a tree — so a beam clears its own path.',
      'It goes on forever in every direction, and no two runs lay it out the same way.',
    ],
  },
  {
    at: '2026-08-16T10:31Z',
    title: 'PAUSE SHOWS THE WHOLE LOADOUT, AND REROLLS ARE FOR SALE',
    notes: [
      'PAUSING NOW SHOWS ALL FIVE GUN SLOTS AND ALL FIVE PASSIVE SLOTS, with the tier of each. The empty ones are drawn too, which is the point: the thing you pause to work out is usually what you have NOT got yet, and a list of only what you are holding cannot tell you that two slots are still free.',
      'The names are the ones the tier has earned - an ascended gun is listed under its new name, exactly as the chip on the HUD reads it.',
      'A NEW WORKSHOP UPGRADE: REROLLS. Three tiers at 30 credits each, and every tier hands you two more rerolls at the start of every run - six on top of the one you already get, if you buy the lot. A reroll deals a fresh three cards and still owes you the pick, so this is straightforwardly more of the run you wanted rather than a bigger number anywhere.',
    ],
  },
  {
    at: '2026-08-16T10:21Z',
    title: 'THE FIELD MANUAL HAS A BESTIARY',
    notes: [
      'EVERY CREATURE IN THE GAME NOW HAS A PAGE. Forty-eight of them: the Scrapyard\'s eight, and Mossy Mayhem\'s eight, each as a regular, an elite and a boss. They are listed in the order you meet them, under the map they belong to, and each one is drawn at the size it actually is - a Colossus takes up more of its row than a Rustling does, because it takes up more of the screen.',
      'A PAGE IS WRITTEN THE FIRST TIME YOU PUT THAT CREATURE DOWN, at that rank. Not on seeing one - something that walks past while you run has taught you nothing. Killing a Rustling gets you the Rustling; the boss version is its own page and its own fight.',
      'AND THE PAGES SAY WHAT THE THING IS FOR. Which way it leans, what changed since the last wave, what it does that the one before it did not - the Formless boss shedding its shell, the Wyrm boss losing a head at a time. No numbers: you are reading it to recognise the next one, not to do arithmetic.',
      'The counter at the top of each map\'s list tells you how many of its twenty-four you have met.',
    ],
  },
  {
    at: '2026-08-16T10:05Z',
    title: 'THE FIELD MANUAL SHOWS BOTH MAPS',
    notes: [
      'EVERY VARIANT AND RANK PAGE NOW SHOWS ONE BODY PER MAP. A swift enemy is illustrated by a Scrapyard machine AND a Mossy creature, side by side, each wearing that variant\'s own cue - the heavy\'s cold tint, the spiky\'s red rim, the boss\'s blue glow. Before this, both maps were explained with a single picture of a scrap machine, which told anyone playing Mossy something that was simply not true.',
      'AND THE TWO ARE DRAWN AT THE SIZE THEY ACTUALLY ARE. They are both the smallest body class in the game, and the page now says so instead of making one look three times the other.',
    ],
  },
  {
    at: '2026-08-16T09:42Z',
    title: 'MOSSY MAYHEM HAS ITS OWN CREATURES',
    notes: [
      'THE THINGS THAT COME AT YOU ON THE MOSS ARE ALIVE. Eight new enemies, none of them a machine and none of them shared with the yard: sporelings, a swarm of flies and bees, jellies and oozes, a jackal pack, a vine stalker, a draconian, golems, and dragons.',
      'THE THREE RANKS ARE THREE DIFFERENT CREATURES NOW, ON MOST WAVES. In the Scrapyard an elite is the same wreck in a different paint. Out here the flies wave sends a blowfly at you, then a killer bee, then a mosquito the size of the bee; the golem wave goes from dirt to stone to iron. You can read what you are looking at without being told.',
      'TWO BOSSES COME APART AS YOU HURT THEM. The snail loses its shell at half health and finishes the fight as a slug. The hydra starts with five heads and drops one for every fifth of its health you take off - so the end of that fight has a countdown in it that you can see from across the field.',
      'THE TWO MAPS NO LONGER SHARE A SINGLE ENEMY NUMBER. Mossy has its own eight waves with their own health, speed, damage and payouts. They start where the yard\'s do, and from here they move independently: tuning one map can no longer change the other by accident.',
    ],
  },
  {
    at: '2026-08-16T08:25Z',
    title: 'MOSSY MAYHEM IS PLAYABLE, AND IT DOES NOT END',
    notes: [
      'THE SECOND MAP OPENS. It has sat on the picker as a locked card with "not built yet" written on it for weeks; it is now a level you can pick and play. Green turf instead of rust, and the horde comes for you on it exactly as it does in the yard.',
      'THERE IS NO FENCE. Not a bigger yard - no edge at all, in any direction. Run one way for as long as you like and the ground keeps going; there is no wall to be cornered against, no corner to be trapped in, and nothing to put your back to. The Scrapyard is a room and this is not.',
      'WHICH MAKES IT A DIFFERENT GAME WITH THE SAME RULES. Every fight in the yard is shaped by the fact that running has an end. Out here running always works, so the question stops being "where do I get pushed to" and starts being "how long can I keep moving".',
      'NOTHING GROWS ON IT YET. The turf is bare - no trees, no rocks, nothing to shoot round or hide behind. That is the next piece of work rather than an oversight: scenery that stops at an invisible line six thousand units out would be worse than none, and an endless map needs it grown around you as you walk.',
    ],
  },
  {
    at: '2026-08-16T00:23Z',
    title: 'DRONES FLY AT A FIXED SPEED, AND THEY ACTUALLY CIRCLE NOW',
    notes: [
      'A DRONE THAT LOCKS ON NOW RUNS STRAIGHT AT ITS TARGET AND THEN GOES ROUND IT. It used to ease in, which meant it was always still closing and never quite arrived - what looked like an orbit was a long spiral that never shut. It now flies in at a flat speed, reaches its ring, and holds it exactly while it shoots.',
      'IT ALSO STOPS FLYING THROUGH THE THING IT IS CIRCLING. It comes in at the nearest point on the ring rather than at whichever side it happened to be facing when it locked on, so a drone crossing to a target no longer passes straight over the top of it.',
      'DRONES HAVE THEIR OWN ENGINE, at a flat 5% over a stock chassis. It does not scale with anything - not the mech you picked, not Servo Drive, not the workshop. Buy movement speed and you will outrun your own escort, which is a real cost of a speed build rather than something that quietly followed you.',
    ],
  },
  {
    at: '2026-08-16T00:02Z',
    title: 'MECH INSURANCE, AND A COUNT OF WHAT IS STILL COMING',
    notes: [
      'A NEW THING IN THE WORKSHOP, AND IT IS NOT A NUMBER. Mech Insurance costs 100 credits and buys one thing: the first hit that would end a run does not. The hull comes back whole and nothing can touch you for three seconds while you get clear of whatever did it.',
      'AND IT LOOKS LIKE SOMETHING. The moment it fires the yard goes gold - a white core pulling inward as the hull comes back together, two shock rings sweeping out past the crowd, and a full circle of embers. It is the loudest thing that happens to your mech in a run, which is about right for the one moment a run was over and then was not.',
      'THE THREE SECONDS ARE VISIBLE TOO. The chassis pulses gold for exactly as long as nothing can touch it, fading as the window closes - so being untouchable is something you can spend rather than something you find out about afterwards.',
      'ONCE PER RUN, AND THE SECOND ONE IS REAL. It is a second chance at the run rather than a spare life you can spend twice - and the immunity is there to get you out of the crowd that just killed you, not to fight in.',
      'It also cannot be spent by the same crowd that triggered it. Everything else touching you on that tick is dropped, so the hull it just gave you back does not go straight down again to the next body in the queue.',
      'THE HUD NOW SAYS HOW MANY ARE STILL ALIVE, beside the kill count. Kills is what the run has done; this is what it is standing in. It is the difference between a wave building and a wave broken, and on a phone screen that is a thing you can otherwise only find out by being surrounded.',
    ],
  },
  {
    at: '2026-08-15T22:40Z',
    title: 'THE WORKSHOP OPENS - CREDITS FINALLY BUY SOMETHING',
    notes: [
      'EVERY BLUE COIN YOU HAVE EVER PICKED UP IS NOW SPENDABLE. The Upgrades screen was a bank statement that admitted, politely, that nothing spent the number on it. It is a workshop now, with seven permanent upgrades that apply from the first second of every run you start afterwards.',
      'HARDER, FURTHER, FASTER, TOUGHER. Ordnance Stores buys damage on every gun, Optical Array buys range, Autoloaders buys rate of fire, Hull Plating buys armour and Servo Tuning buys movement. Two are for particular builds: Coolant Baffles cools the beams, and Fabricator Feed turns the drone bay around sooner.',
      'AND ORDNANCE STORES COSTS A LASER HEAT, the same way the Ordnance card does and the same way a laser\'s own damage rungs do. Raw power on a beam has always bought itself shorter bursts in this game; a permanent upgrade is the last place that should have been an exception, because unlike a card it is in play from the first second of every run. Coolant Baffles is how you buy the burst back.',
      'EACH ROW SAYS WHAT YOU ARE ACTUALLY RUNNING WITH. The blue line is the effect you own right now - three tiers of Ordnance Stores reads "+12.9% damage" - with what it comes to at full tier beside it in grey, so a price still has something to be judged against.',
      'EVERY TIER OF ONE UPGRADE COSTS THE SAME AND IS WORTH THE SAME. The cards you find mid-run get better as they go, so the last rung is the best one - the workshop deliberately does not, because a shop where saving up is always correct is a shop with no decision in it. The only question here is WHICH, never when.',
      'REFUND ALL, AT FULL PRICE, ANY TIME. Every upgrade goes back to zero and every credit comes back - no fee, nothing lost. Trying a build is not supposed to be something you have to be careful about, and a refund that charged for the privilege would make it exactly that.',
      'IT ADDS WITH YOUR CARDS RATHER THAN MULTIPLYING WITH THEM. A maxed Ordnance card and a maxed Ordnance Stores is the two of them added together, the same way every other percentage in this game stacks. A permanent upgrade that compounded would be quietly worth several times more to a finished build than to a fresh one, and nothing on either screen would have said so.',
    ],
  },
  {
    at: '2026-08-15T22:25Z',
    title: 'AN ASCENSION YOU HAVE HELD GETS ITS OWN PAGE',
    notes: [
      'THE MANUAL WILL NOW ADMIT TO A TIER 8 - but only one you have actually held, and only after you have held it. It gets an entry of its own under a new ASCENSIONS heading, with its own name, its own icon and its own page, rather than a footnote on the weapon it stopped being.',
      'The page says what it does, what it used to be, and what it cost you - in the past tense, because the only person who can read it is the person who already paid. It says nothing whatsoever about any other weapon.',
      'UNTIL THEN THE MANUAL IS EXACTLY WHAT IT WAS. The heading does not exist, the weapon it comes from gives nothing away, and no counter anywhere moves - the Weapons total still reads nine, because a total that quietly grew by one would be the secret announcing itself to somebody who had found nothing.',
    ],
  },
  {
    at: '2026-08-15T20:15Z',
    title: 'THE YARD HAS GROUND NOW, AND THE GROUND HAS ROADS',
    notes: [
      'THE FLOOR HAS STOPPED REPEATING IN YOUR FACE. It was one small square of rust laid down two hundred times across the arena, and at that spacing the eye finds the loop within about a second and never unsees it. The ground is now a much larger patch of the same rust, arranged so no part of it lines up with any other part - so it reads as dirt rather than as wallpaper.',
      'SERVICE ROADS RUN THROUGH THE YARD. Pale worn plating somebody laid down long before you got here, crossing at junctions, a few hundred units apart. They are not cover and nothing about them changes how you move: they are there so that every direction stops looking like every other direction. Chasing an arrow off the edge of the screen is a different job when you can tell you have crossed the same road twice.',
      'AND THEY ARE ROADS RATHER THAN RULED LINES. They wind as they go and never hold a straight line for long, they come apart into stretches where the scrap has taken them back, and there are patches of yard with no road in them at all - so how far you are from the next one is a real question instead of a fixed number. Where two of them meet, the crossing is always intact. That is the one bit of the yard you can give directions to.',
      'RUBBLE AND BOULDERS ARE SCATTERED OVER IT, dim and still and firmly underfoot. You walk straight through them - they are ground, not scenery, and nothing about them will ever block a shot. They exist so the floor has things on it to measure your own speed against.',
      'None of it spawns on top of you. A run still opens on a clear patch of yard with nothing under the mech, and what the yard holds is decided by the run’s seed, so the same seed lays out the same roads and the same rocks every time.',
    ],
  },
  {
    at: '2026-08-15T19:49Z',
    title: 'FIELD REPAIR - a system that mends you on a clock',
    notes: [
      'A NEW SYSTEM, AND IT IS THE ONLY THING IN THE YARD THAT MENDS YOU WITHOUT BEING PICKED UP. Every few seconds a repair clock comes round and puts a little of your hull back. It is not much at once; what it changes is that being hurt stops being permanent between barrels.',
      'HALF ITS LADDER MAKES EACH REPAIR BIGGER AND HALF MAKES IT COME ROUND SOONER, which are genuinely different things - more is worth having when a repair lands, sooner is worth having while you are still being chased. Finished, it is repairing every five seconds.',
      'IT STARTS LOCKED, AND IT IS EARNED BY SURVIVING SOMETHING: drop below a fifth of your hull at any point in a run, and reach full hull again before that run is over. The two do not have to be close together - once a run has been down there, it stays owed to you for the rest of it. With the level-up heal gone and a spanner the only thing that mends you, that still asks a lot. A run that manages it has earned a repair clock.',
      'It only mends what is missing. At full hull the clock sits at the top of its dial, so the first repair after a hit is always a whole interval away rather than arriving because the timer happened to be due.',
      'THE CYBER CHEST LOOKS CYBER NOW. It was a pirate’s treasure chest - lid, corner braces, a latch - which is a fine chest and the wrong one for a yard made of panelled steel and thin blue light. It is a data vault: a chamfered slab with a lit screen and circuit traces running out of it, in the same blue as every sight and shield rim.',
    ],
  },
  {
    at: '2026-08-15T19:38Z',
    title: 'A die in the drums, and gems that actually arrive',
    notes: [
      'BARRELS CAN HOLD A DIE. It is the rarest thing in a drum by a wide margin - about one a run - and it banks an extra REROLL for the rest of the run. Everything else a barrel gives you resolves the moment you touch it; this is the only one you get to decide what to do with later.',
      'AND THERE ARE MORE DRUMS TO BREAK, about a quarter more. The wrecks and girders are exactly as thick on the ground as they were: only the barrels went up, so the yard is more generous without being more cluttered.',
      'XP GEMS NO LONGER ORBIT YOU. A gem flung sideways would swing round and round instead of arriving, and if its circle carried it out of range the pull let go and it stopped dead somewhere behind you. Both were the same missing piece. They now curve in hard and land - a gem thrown sideways at full speed is in your pocket in half a second, where before it never arrived at all.',
      'THE OFF-SCREEN BOSS POINTER IS RED with a black edge, instead of the muted steel it borrowed from the boss outline. It has to be findable against rust ground, a fence, and a wall of bodies.',
      'AND CHESTS GET THE SAME POINTER IN BLUE. A boss is enormous and coming towards you; a chest is a silent box left wherever the fight happened to end, which after a long boss is nowhere near where you are standing.',
      'THE CYBER CHEST HAS A SPRITE AT LAST. It was being drawn as a single COIN - the smallest thing in the game - because nothing had ever given it art. It is now a strongbox with a lit seam, drawn bigger than the other drops, and it sits ON TOP of the boss core rather than underneath it.',
    ],
  },
  {
    at: '2026-08-15T19:15Z',
    title: 'The Cyber Chest calls out what you just hit',
    notes: [
      'EVERY RESULT HAS A NAME NOW, and it lands above the reels the instant the third one stops - ODDMENTS, MATCHED SET, DOUBLE UP, PAIR AND SPARE, and MOTHERLODE for three of a kind.',
      'THE NAMES DESCRIBE THE COMBINATION rather than just shouting louder. The old words were four ways of saying "bigger", which told you nothing you could not read off the number underneath; these tell you WHY it paid what it did, so the machine teaches its own rules while you watch it.',
      'The two best results say so in the type: a pair and spare glows, and a motherlode burns.',
      'It sits above the reels rather than over them, so the symbols that earned the word are still there to look at while you read it.',
    ],
  },
  {
    at: '2026-08-15T19:02Z',
    title: 'The missile chassis get their swinging barrel back',
    notes: [
      'ONYX, ASH AND THE OTHER RACK MECHS had their barrel welded to their legs a few builds ago - it only moved when the whole machine turned. That was a mistake made while fixing Fern’s turret, and it is undone: the mount sweeps onto the horde again, the way it always did.',
      'A rack still fires where you are RUNNING, not where the barrel points. The barrel was never the aiming cue on those chassis - it is the mech looking at what is about to be a problem.',
      'Fern is unchanged and correct: the drone bay has nothing to aim, so her barrel rides the chassis until she picks up a real gun, and then follows that.',
    ],
  },
  {
    at: '2026-08-15T17:48Z',
    title: 'A dying drone goes off with a pop, not a bang',
    notes: [
      'THE DETONATION IS MUCH WEAKER - it was worth a full artillery shell and is now worth about four of the drone’s own rounds. It will still finish something wounded that happens to be standing there, and that is all it is for.',
      'A DRONE IS THE TWENTY SECONDS OF SHOOTING, not the explosion at the end. The old blast was strong enough that letting one die in a crowd paid better than flying it properly, which is the opposite of what the weapon is about.',
      'The blast radius has not changed, so the crater on screen is still the crater that hurts.',
    ],
  },
  {
    at: '2026-08-15T17:40Z',
    title: 'Drone build time settles at sixteen seconds',
    notes: [
      'A DRONE TAKES SIXTEEN SECONDS TO BUILD, up from twelve. Twelve was set while the rate systems were still quietly shortening a drone’s life - now that they are not, drones last half again as long and the bay does not need to work as hard to keep a full flight in the air.',
      'A finished Fern still has all four up for about nine tenths of a run. What changes is that the chassis and the rate systems are visibly worth something again: a pilot with neither now has to work for their fourth drone.',
    ],
  },
  {
    at: '2026-08-15T17:26Z',
    title: 'Feed Systems no longer shortens a drone’s life',
    notes: [
      'FEED SYSTEMS WAS SECRETLY A DRONE NERF. A drone’s magazine is its life, so making it fire faster only made it die sooner - the card that says "everything fires more often" was quietly buying you fewer drones. Drone rounds ignore it now. The BAY still takes it and builds faster, which is where a rate bonus belongs on a weapon that is a factory.',
      'TARGETING OPTICS NO LONGER TOUCHES DRONES EITHER. A drone’s reach is not just how far it shoots - it also sets how close something has to come to YOU before a drone will go after it, and how far out it is then allowed to be. A range card was moving all three at once, including the leash that keeps drones on your screen.',
      'ORDNANCE STILL WORKS. A damage build makes your drones hit harder, exactly as you would expect from something that fires a machine gun.',
    ],
  },
  {
    at: '2026-08-15T16:58Z',
    title: 'The drone bay builds twice as fast',
    notes: [
      'A DRONE TAKES TWELVE SECONDS TO BUILD, DOWN FROM TWENTY-FIVE, and every tier that trims the build trims a share of the smaller number - so a finished bay turns one out every 7.8 seconds, or under 4.5 with the chassis and the rate systems behind it.',
      'THE POINT IS THE FOURTH DRONE. Tier 7 promises four and you were flying about three: they were dying faster than the bay could replace them, so the last tier of the ladder was buying a number you rarely saw. A finished Fern now has all four up for about nine tenths of a run instead of two fifths.',
      'It barely touches the early game, and that is deliberate. The first two tiers only ever allow ONE drone, and one drone already outlives its own replacement several times over - what this changes is how fast a FLEET recovers once you are flying three or four.',
    ],
  },
  {
    at: '2026-08-15T16:49Z',
    title: 'The missile symbols are painted like the missiles',
    notes: [
      'BOTH RACKS NOW WEAR THE ART’S OWN COLOURS on the Cyber Chest reels - pale steel bodies with bright blue fins, the same thing you watch fly across the yard, rather than a pair of amber wedges.',
      'The tile border stays amber, so they still read as guns at a glance and a spin still tells you what it is worth before the words arrive.',
    ],
  },
  {
    at: '2026-08-15T16:44Z',
    title: 'The Long Missiles symbol shows all three of them',
    notes: [
      'IT DREW ONE MISSILE, AND THE RACK FIRES THREE. Beside the short rack’s two that made the difference between them look like two against one, when it is two fat missiles against three thin ones. The reel now shows what actually leaves the rack.',
    ],
  },
  {
    at: '2026-08-15T16:40Z',
    title: 'The two missile racks look like two different weapons',
    notes: [
      'SHORT MISSILES ARE FATTER AND LONG MISSILES ARE THINNER. The two racks were always different lengths and almost the same width, which is a hard thing to tell apart on something 20 units long crossing the screen. The gap between them is now more than twice what it was, so a volley says which rack fired it.',
      'AND THEIR REEL SYMBOLS ARE ACTUALLY MISSILES NOW. They were flat-sided wedges with two little tabs at the bottom - a picture of the word rather than of the thing. They have the rounded nose and the big swept fins the real ones fly with, drawn at the same proportions, so the symbol on the machine teaches the silhouette you will be reading in a fight.',
    ],
  },
  {
    at: '2026-08-15T16:34Z',
    title: 'Hit points come from one place now',
    notes: [
      'LEVELLING UP NO LONGER REPAIRS YOU. It used to hand back a slice of your hull every level, which quietly made a good run a healthier one as well as a stronger one - two rewards on one event, and the quieter of them was carrying the run. A level is power. Nothing else.',
      'A SPANNER AT FULL HEALTH IS NO LONGER WASTED. Walk over one with a full hull and it stays on the ground waiting for you. It used to be consumed for nothing, which meant the one reward that answers "I am about to die" was mostly being destroyed by people who were fine.',
      'Between them: the repair spanner is now the ONLY thing in the yard that gives you hit points back, and it keeps until you need it. A barrel you leave standing is a barrel you can come back to.',
      'THE TIER BADGE IS GONE FROM THE WEAPON CHIPS. "T4" beside the name was a number that only ever went up and never changed what you would do next; the bar beside it answers the question you actually have, which is whether the gun can fire right now.',
      'A weapon that ascends now correctly renames itself on the chip. A Medium Laser that became a Chain Laser had been reading as a Medium Laser for the rest of the run.',
    ],
  },
  {
    at: '2026-08-15T16:07Z',
    title: 'Drones last twice as long and hit half as hard',
    notes: [
      'A DRONE CARRIES A FULL MAGAZINE AGAIN, and each round is worth half what it was. The same damage from a drone over its life - but it takes twice as long to spend, so a drone is something you keep rather than something that keeps evaporating. Its dying blast is unchanged.',
      'FERN’S TURRET NO LONGER POINTS AT NOTHING. The bay has no barrel, so the drawn turret was locked to it and sat pointing the same way all run. It now tracks the mech until she picks up a real gun and then follows THAT - the same way the missile chassis have always worked.',
    ],
  },
  {
    at: '2026-08-15T15:54Z',
    title: 'More rings, and more chests to chase',
    notes: [
      'RING ATTACKS AND CHEST ELITES BOTH TURN UP MORE OFTEN. A little over two rings and a little over one chest elite in an average run, up from two and one.',
      'The chest elite gained the most. It used to arrive exactly half as often as a ring attack; it now arrives closer to six times for every ten rings, so a run that goes the distance can expect more than one.',
      'The swarm did not change. It is a slightly smaller share of the table only because there is more else in it.',
    ],
  },
  {
    at: '2026-08-15T15:49Z',
    title: 'THE SWARM is what the yard does now',
    notes: [
      'THE SWARM ARRIVES TWICE AS OFTEN AS EVERYTHING ELSE PUT TOGETHER. It is up from about three a run to nearly six, which is close to three hundred extra runners across a full run. It is no longer the occasional set-piece - it is the thing a run is made of, and a build that cannot handle a front pouring past it will find out quickly.',
      'MOST WAVES NOW BRING SOMETHING. Six waves in ten get a set-piece where it used to be four - the quiet stretch you could count on between them is gone.',
      'Ring attacks and chest elites are unchanged in absolute terms - the same two rings and the same one chest elite in an average run. They are simply a smaller share of a busier table.',
    ],
  },
  {
    at: '2026-08-15T15:41Z',
    title: 'Set-pieces happen more often',
    notes: [
      'A WAVE IS NOW LIKELIER TO BRING SOMETHING WITH IT. Ring attacks, swarms and chest elites are all about a seventh more common - roughly six a run where it was five - and the quiet stretches between them are shorter.',
      'All three went up together, in proportion. Which set-piece you get is exactly as likely as it was; there are simply more of them.',
    ],
  },
  {
    at: '2026-08-15T15:34Z',
    title: 'THE CHEST ELITE - one enemy in the yard is worth chasing',
    notes: [
      'A NEW SET-PIECE, AND IT IS A REWARD. A single gold elite walks in on its own, and it leaves a CYBER CHEST where it falls. It is the first chest in the game that is not a boss, and the first enemy you should want to see.',
      'IT IS A REAL FIGHT. Three times the hit points of the elite it otherwise is - fifteen times an ordinary body - so taking it down is something you have to commit to while the wave keeps arriving. Walk away and it stays out there.',
      'AND IT FOLLOWS. Every other big thing in the yard trades speed for bulk and can be left standing; this one is slightly faster than an elite, which is enough that it will not simply be where you left it.',
      'It pays half the usual experience. The chest is the payment.',
      'It arrives half as often as the ring attack - about one a run - and it can never turn up in the ordinary horde. Nothing about how often you see a ring attack or the swarm has changed.',
    ],
  },
  {
    at: '2026-08-15T15:23Z',
    title: 'A Cyber Chest with nothing left to give now shows you that',
    notes: [
      'THE REELS NO LONGER SPIN THROUGH NOTHING. Open a chest once every upgrade in the game is taken and the machine ran three strips of empty tiles and stopped on three empty windows. It still paid out - the repair and the salvage were always there underneath - but it looked broken, which for a slot machine is the same as being broken.',
      'It now lands all three reels on the salvage symbol, the same way an ascension puts its own symbol on all three: this is a result that was decided before the reels moved, and the machine says so rather than pretending to roll.',
      'AND THE SPIN ITSELF HAS SOMETHING TO SHOW. A late chest with your whole loadout maxed used to blur past one icon repeated over and over. It now spins through the kit you are carrying - the actual reason it has nothing to add.',
    ],
  },
  {
    at: '2026-08-15T15:11Z',
    title: 'Drones arrive sooner, shoot bullets, and have a face on the reels',
    notes: [
      'THE BAY BUILDS FIVE SECONDS FASTER. Twenty-five to start rather than thirty, and every tier that trims the build time trims a share of the new number - so a finished bay turns one out every sixteen seconds instead of twenty.',
      'A DRONE FIRES MACHINE GUN ROUNDS, and now they finally look like it. They were being drawn as CANNON shells, so a drone appeared to be lobbing artillery at a runt while its card said machine gun. Same tracer the gun uses, one at a time rather than the gun’s pair.',
      'THE CYBER CHEST HAS A DRONE SYMBOL. It had none, so the drone rolled up as an empty tile on the reels - unreadable on the one screen in the game where you have half a second to read it. It is a quadcopter seen from above, and it is the only symbol on the reels that does not point anywhere.',
    ],
  },
  {
    at: '2026-08-15T14:49Z',
    title: 'Drones stay in your fight instead of wandering out of it',
    notes: [
      'A DRONE NOW HUNTS YOUR CIRCLE, NOT ITS OWN. It engages anything that comes near YOU and will fly any distance to reach it - but nothing far from you is a target, however close it has drifted to the drone.',
      'THIS IS THE FIX FOR DRONES DISAPPEARING. They used to hunt from wherever they happened to be standing, so a kill out at the edge put them in reach of something further out, then something further out again. A spread-out wave could walk a drone off the screen one target at a time and it never came home. Measured across three full runs, a drone spent a THIRD of its life completely off screen; it now spends none of it there.',
      'AND A DRONE THAT IS TRAILING YOU CAN STILL FIGHT. Left behind by a sprinting mech, it used to go inert - everything worth shooting was up ahead near you, too far from the drone to count. It now joins in from wherever it is.',
      'A flight of drones spreads across the near end of a crowd rather than all piling onto the same enemy.',
    ],
  },
  {
    at: '2026-08-15T14:37Z',
    title: 'A drone carries half the ammunition, and flies half as fast again',
    notes: [
      'A DRONE NOW LAUNCHES WITH HALF THE ROUNDS. Its magazine is its life, so this is its life: it detonates in about half the time it used to, and the blast has to be a bigger part of what you get out of it. The bay builds them just as quickly, so what changes is how much each one is worth rather than how many you have.',
      'AND HALF THE SPEED AGAIN. A drone at full stretch now trails a running mech by about three escort radii - it catches up when you stop, but it will not keep station with you across the yard. Standing still is worth something to a drone pilot.',
    ],
  },
  {
    at: '2026-08-15T14:22Z',
    title: 'Drones fly at half speed, and stay in the fight',
    notes: [
      'DRONES MOVE HALF AS FAST. Both halves of it - the orbit and the flight between targets - so the path is the same shape and you can now actually watch one work rather than seeing a streak.',
      'AND THEY WILL NOT WANDER OFF. Nothing more than about two screens from YOU is a target any more, however close it is to the drone. A drone hunts from where it is standing, which meant a spread-out wave could hand it one target after another and walk it clean off the edge of your fight.',
      'A target that walks out past that line is dropped mid-engagement rather than towed along.',
      'FERN NOW SITS NINTH ON THE MECH PICKER, just under Plum, instead of last.',
    ],
  },
  {
    at: '2026-08-15T14:12Z',
    title: 'Drones look like drones',
    notes: [
      'THEY HAVE THEIR OWN SPRITE NOW - a round hull with four rotor discs and a blue lens in the middle, spinning as it flies. They shipped yesterday wearing the missile art, which was a stand-in and a bad one: a missile has a nose, so the eye reads it as travelling the way it points, and a drone spends its life orbiting - which meant an arrowhead spinning on the spot.',
      'A disc reads the same at every angle, which is right for something whose facing is not information.',
    ],
  },
  {
    at: '2026-08-15T14:03Z',
    title: 'DRONES - a weapon that builds things instead of firing them',
    notes: [
      'A NINTH WEAPON, AND IT IS NOT A GUN. The bay builds a drone, and the drone does the fighting. It flies escort around you until something comes within twice its reach, then goes and circles THAT and empties a machine gun into it. When the target dies it comes home - picking up anything it passes on the way, so a drone out on a kill will chain across a crowd without ever coming back to you.',
      'ITS MAGAZINE IS ITS LIFE. There is no reload. When the last round is gone it detonates, and the blast is worth about one artillery shell. A drone is something you spend.',
      'THE BAY KEEPS BUILDING AT FULL STRENGTH. One finished drone is held in reserve, so a loss is replaced the instant it happens rather than thirty seconds later. Only one, though - you cannot stockpile a squadron through a quiet minute.',
      'It levels into more drones and shorter builds: one at first, four when it is finished, and the build comes down from thirty seconds to about twenty.',
      'FERN OPENS WITH THEM, builds them 10% faster, and is available from the start alongside Slate.',
      'THE DRONE CARD ITSELF IS LOCKED until you beat the yard. It is the first card in the game you have to earn - every other one has always been in the deck from your first run. Fern is the way in until then.',
      'Indigo now opens with the Heavy Artillery, which Fern used to. The long missile racks had three chassis and the artillery would otherwise have had none.',
    ],
  },
  {
    at: '2026-08-15T13:30Z',
    title: 'Two lasers no longer burn the same body',
    notes: [
      'EVERY LASER PICKS THE WEAKEST THING IN RANGE, which meant two of them picked the SAME thing and the second one spent its beam on hit points the first was already removing. Three lasers meant three beams into one runt.',
      'A body another laser has already chosen is now invisible to the next one, so they spread across the crowd instead of stacking. Measured over five headless runs with every weapon fitted: the lasers put out about 3% more damage per second, runs lasted 4% longer, and the Long Laser gained most.',
      'THE COST, AND IT IS A REAL ONE: on a nearly empty field there may be fewer bodies than you have lasers, and the surplus ones now hold fire rather than piling on. Overlap is only waste when there is a crowd, and a crowd is where a run is actually decided.',
      'A laser that has overheated reserves nothing. It has cut out; it does not get to hold a target hostage from the one still working.',
    ],
  },
  {
    at: '2026-08-15T13:21Z',
    title: 'The Chain Laser is the mechanic and nothing else',
    notes: [
      'TIER 8 NO LONGER CARRIES ANY STATS. It used to hand out half a dispersion rung and extra reach alongside the chain. Those are gone - the tier buys the CHAIN, and that is the whole of it.',
      'They were the wrong two to give away, because they are precisely the two the chain spends. Reach is the literal budget a chain is paid out of and dispersion is the uptime a beam crossing four bodies wants, so the capstone was quietly scaling its own new behaviour on top of granting it. A tier 8 should be a different weapon, not the same weapon with a stat card stapled on.',
      'The Medium Laser is untouched at every tier up to seven.',
    ],
  },
  {
    at: '2026-08-15T13:21Z',
    title: 'Two more silhouettes can be earned',
    notes: [
      'ONE WANTS YOU TO GET HIT. Twenty times in a run, by anything - a rim eating a bite does not count, because nothing touched you.',
      'THE OTHER WANTS YOU TO LOSE, and to lose to something specific. It is the only condition in the game a winning run can never satisfy.',
      'Which mech is behind which silhouette is still yours to find out.',
    ],
  },
  {
    at: '2026-08-15T12:05Z',
    title: 'A version number, three more chassis to earn, and a proper unlock notification',
    notes: [
      'THE TITLE SCREEN SAYS WHICH BUILD YOU ARE PLAYING, at the bottom - a number and the commit it came from. It goes up once per deploy, so "have you got the fix yet" is now a thing you can answer by looking.',
      'NOTHING YOU EARNED IS LOST BY ABANDONING A RUN. Achievements, chassis and bestiary entries are written to your save the moment you earn them rather than when the run ends, so quitting - or a phone call, or the browser reloading the tab - keeps what you did. Abandoning banks whatever the run had earned on the way out.',
      'THE ACHIEVEMENT NOTIFICATION IS A PROPER ONE NOW. It slides up out of the bottom corner with the picture of the thing you just earned on it, says ACHIEVEMENT UNLOCKED, and stays half again as long. It used to be a centred banner in the same slot the update prompt uses, which made a reward look like a system message.',
      'THREE MORE SILHOUETTES CAN BE EARNED. One wants a hundred things destroyed with a missile. One wants the killing blow on a boss from a missile. One wants a finished Energy Shield. Which mech is behind which is still yours to find out.',
      'The missile conditions mean the KILLING BLOW, not damage dealt - a rack that softens everything and never finishes anything has not killed with it.',
    ],
  },
  {
    at: '2026-08-15T11:54Z',
    title: 'The update prompt waits for the title screen',
    notes: [
      '"NEW VERSION AVAILABLE" NO LONGER APPEARS MID-RUN. A new build is usually found a minute or two into a session, which is to say during a fight - and what appeared there was a button marked RELOAD, in the thumb zone, over a run it would have thrown away.',
      'It waits for the title screen now, and comes down again the moment you leave it. Nothing is lost by waiting: the new build is already downloaded and sitting there, and it goes in when you have nothing to lose.',
    ],
  },
  {
    at: '2026-08-15T11:42Z',
    title: 'Back in the Scrapopedia actually closes the entry',
    notes: [
      'GOING BACK FROM AN ENTRY LEFT IT ON SCREEN, sitting underneath the list you had just returned to. It closes now.',
      'THE SAME BUG WAS ON THE LEVEL-UP CARDS. A level-up with fewer offers than there are slots left an empty bordered card in the gap. Both were one missing line of stylesheet - the code was hiding them correctly and the hiding was being ignored.',
    ],
  },
  {
    at: '2026-08-15T11:37Z',
    title: 'The bestiary is written by killing things',
    notes: [
      'AN ENEMY GETS ITS PAGE THE FIRST TIME YOU DESTROY ONE. Not the first time you see one - something that walks past while you run has taught you nothing. The Enemies section starts empty and fills in as the yard sends you things you can handle.',
      'There is no achievement for it. A first kill is not an accomplishment, it is a note about how far you have got, and nine trophies for meeting the bestiary would drown the ones that mean something.',
    ],
  },
  {
    at: '2026-08-15T11:29Z',
    title: 'The Scrapopedia gets sections, an enemy manual and an achievement list',
    notes: [
      'IT OPENS ON FOUR BUTTONS NOW - Systems, Mechs, Enemies, Achievements - rather than one long list of everything. Back walks one step at a time: page, list, sections, out.',
      'ENEMIES IS NEW. Every variant the yard has, and what each is FOR: the swift one that arrives ahead of its wave, the spiky one that hits far harder than it looks and that no weapon you carry will prioritise, the wall that walks, the fifty runners that pour past rather than at you. Plus the three ranks, and why a boss cannot be pushed.',
      'The rows carry the same cues the battlefield does - the size step between a runt and a bruiser, the Heavy’s cold tinge, the Spiky’s red rim, the boss outline - so what you learn here is what you recognise out there.',
      'ACHIEVEMENTS IS NEW TOO, and it lists them all. An earned one shows what you did. An unearned one is greyed and says nothing - you get the name and not one word about how to get it.',
    ],
  },
  {
    at: '2026-08-15T11:16Z',
    title: 'Unlock criteria are not published anywhere',
    notes: [
      'THE CONDITION IS OFF THE MECH PICKER. A locked chassis is a silhouette and a question mark, and that is the entire tile - no name, no description, and now no hint about what would earn it.',
      'THE ACHIEVEMENT IS THE ONLY PLACE AN UNLOCK IS EVER STATED, and it says it in the past tense, at the moment you have already done it. "Moss - Reached wave 3." You find out what the criteria were by meeting them.',
    ],
  },
  {
    at: '2026-08-15T11:05Z',
    title: 'Two of the silhouettes can be earned',
    notes: [
      'TWO LOCKED CHASSIS NOW HAVE CRITERIA, printed under their silhouette. One asks you to reach wave 3. The other asks you to kill a boss with the Long Laser in your loadout - not to land the killing blow with it, just to have it on the mech when the boss goes down.',
      'Which mech is behind which silhouette is still for you to find out. The condition tells you what to do, not what you get.',
      'EVERY CHASSIS UNLOCK ALSO CARRIES AN ACHIEVEMENT, so earning one now lands a banner as well.',
      'The boss condition is judged at the MOMENT THE BOSS DIES, not at the end of the run. Killing a boss bare-handed at wave 2 and picking the laser up at wave 5 does not count - which is the only reading that makes it a thing you play toward rather than a thing that happens to you.',
    ],
  },
  {
    at: '2026-08-15T10:57Z',
    title: 'A locked mech is a silhouette with a question mark',
    notes: [
      'NO NAME, NO DESCRIPTION, JUST A SHAPE. A chassis you have not earned is now a blacked-out outline with a ? over it. You can see there is a mech there and roughly how it is built - two legs or four, boxy or lean, what it carries on its shoulders - and nothing at all about which one it is or what it does.',
      'It used to show the art greyed out with the name and the identity line still readable, which told you exactly what you were missing and left nothing to find out.',
      'The word "Locked" is gone from the tile too. The silhouette says that already.',
    ],
  },
  {
    at: '2026-08-15T10:31Z',
    title: 'The roster is down to Slate while the unlocks are written',
    notes: [
      'FIFTEEN CHASSIS ARE LOCKED, AND THERE IS NO WAY TO EARN THEM YET. They read "Locked" rather than naming a target, because there is no target: what each one asks for is still being decided, and inventing a number to fill the gap would only mean picking a design by accident and arguing it out later.',
      'You can still see all sixteen. The mech you want is on the screen, greyed out, waiting for its criteria.',
      'The conditions that were briefly here - reach wave 2, wreck four hundred, finish the Cannon - were placeholders and are gone. Anything they granted is gone with them.',
      'The Scrapopedia is unaffected: it still fills in as you hold things, and it still lists every mech you have.',
    ],
  },
  {
    at: '2026-08-15T10:19Z',
    title: 'Achievements',
    notes: [
      'THERE ARE ACHIEVEMENTS NOW. One of them, and it is a secret, so you will find out what it is by earning it. A banner drops in at the top of the screen the moment you do - it does not stop the game, it cannot be tapped by accident, and it goes away on its own.',
      'It is remembered forever once earned, and it is checked while you play rather than at the end, so it lands on the moment rather than on the summary screen.',
    ],
  },
  {
    at: '2026-08-15T10:10Z',
    title: 'A roster you earn, and a manual you fill in',
    notes: [
      'THE SCRAPOPEDIA STARTS ALMOST EMPTY. One mech and one gun: Slate, and the Medium Laser it walks in holding. Every other page is written the first time you actually hold the thing - take the artillery once and its page is yours forever, whatever happens to that run.',
      'IT IS A RECORD, NOT A CATALOGUE. Each group says how much of it you have found - "3 of 8" - so you can see the shape of what is left without being told what it is.',
      'THIS GATES THE MANUAL AND NOTHING ELSE. Every card is still offered in every run from the first minute. Nothing is harder to find than it was; the reading is what you unlock.',
      'FIFTEEN OF THE SIXTEEN CHASSIS NOW HAVE TO BE EARNED, and each one asks for something different. Reach wave 2. Wreck four hundred things in a run. Finish the Cannon. The condition is printed on the locked mech itself, because a mech you cannot have and cannot find out how to get is not a goal, it is just a gap.',
      'A locked chassis cannot be picked. It is still there to look at.',
      'AND THE RUN THAT EARNS ONE SAYS SO, at the top of the summary, above every statistic. That is the news; the damage breakdown can wait.',
      'These conditions are a first pass and will be retuned. If your save is wiped - the browser does that on its own after a week or two of not playing, which is why installing to the home screen matters - your roster goes with it.',
    ],
  },
  {
    at: '2026-08-15T09:53Z',
    title: 'The barrel shows the gun that is aiming, and the manual stops spoiling tier 8',
    notes: [
      'THE TURRET ON TOP OF YOUR MECH NOW FOLLOWS THE FIRST WEAPON THAT ACTUALLY AIMS. A missile rack does not aim - it fires along the direction you last moved - so on a chassis that walks in holding one, the barrel used to be welded to the legs and swung only when you turned. Pick up a cannon or a laser and it now swings onto that instead, which means the barrel is once again the cue that tells you what your mech has decided to shoot.',
      'It follows the FIRST such weapon and keeps following it. A mount that jumped to whatever you most recently picked up would be a cue about your last card rather than about the fight.',
      'THE SCRAPOPEDIA NO LONGER MENTIONS TIER 8 AT ALL. It used to print the ascension in full - its name, what it does, and the exact recipe - and drop a hint about it on an unrelated system page. That is the one thing in this game meant to be found rather than read, and a player who opened the manual once had it handed to them.',
    ],
  },
  {
    at: '2026-08-15T09:46Z',
    title: 'The Scrapopedia gets the mechs, and a Back button that says Back',
    notes: [
      'EVERY CHASSIS NOW HAS A PAGE. All sixteen of them, listed under the weapons and the systems, each with its portrait, what the frame is built to do, and the gun it walks in holding - including the one that walks in holding nothing.',
      'A mech page also names the system already fitted to it before the run begins, so you can tell at a glance which chassis start a step ahead and on what.',
      'THE BACK BUTTON SAYS "BACK". It used to rename itself "All entries" on a page, which described where it went rather than what it did.',
    ],
  },
  {
    at: '2026-08-15T09:30Z',
    title: 'THE SCRAPOPEDIA - a field manual on the title screen',
    notes: [
      'A NEW ENTRY ON THE TITLE SCREEN. Every weapon and every system, tap one for a page on what it actually does.',
      'IT EXISTS TO ANSWER ONE QUESTION: how does this thing choose what to shoot? Every weapon in the game answers differently and a level-up card has no room to say so. The Cannon insists on the BIGGEST enemy in range while the Machine Gun finishes the smallest. The missile racks do not aim at all - they fire along the direction you last moved, so turning to face something is how you point them. The artillery never even looks at the horde.',
      'None of that is on a card, all of it changes how you play, and now there is somewhere with room to explain it.',
      'Each page also lists what the thing does as it levels, and names the tier 8 for the weapon that has one.',
    ],
  },
  {
    at: '2026-08-15T09:04Z',
    title: 'Cards say what they do, not by how much',
    notes: [
      'EVERY UPGRADE CARD HAS LOST ITS NUMBERS. "Weapon range +7%" is now "every weapon reaches further". "Damage +26/s, but heat +6.6/s" is "burns hotter - and heats itself up faster doing it". A card is a decision you make in four seconds with a horde closing in, and a percentage invites arithmetic instead.',
      'EXTRA PROJECTILES STILL COUNT, because that is not a magnitude - it is a different thing happening. A third missile is three warheads in the air where there were two, and you can see it. So can the extra enemy a Cannon shell punches through, and the second rim on the Energy Shield.',
      'THE LADDERS STILL READ AS LADDERS. A passive gets stronger with every tier taken - the last is worth about twice the first - so the wording climbs with it: a little further, further, much further.',
      'Nothing about any weapon changed. This is what the cards SAY, not what they do.',
    ],
  },
  {
    at: '2026-08-15T08:50Z',
    title: 'A bigger swarm, and Heavies that stay where you left them',
    notes: [
      'THE SWARM IS FIFTY RUNNERS, up from forty - the same number the ring brings.',
      'HEAVIES WALK ANOTHER 10% FASTER. Still the slowest thing in the yard by a wide margin.',
      'AND THEY BARELY MOVE WHEN SHOT. A shell now shoves a Heavy a quarter as far as it would shove anything else, down from half. At half, one Cannon hit was still worth twenty-four seconds of its walking - the wall could be swept aside faster than it could close.',
      'AND A RING YOU STEP AWAY FROM IS STILL THERE WHEN YOU COME BACK. Anything that falls too far behind you gets picked up and re-dealt in front of you, which is what keeps the yard feeling endless - but that rule takes formations apart rather than moving them, so a ring used to come back as fifty unrelated bodies scattered around you a few seconds later. A Heavy now gets four times the leash: 4000 units, eight screens, about twenty seconds of running flat out. Walk off, deal with something else, come back - the ring is standing where it closed. Genuinely cross the yard and it comes with you, because an abandoned set-piece parked in a corner forever is not a thing you should be able to leave behind either.',
    ],
  },
  {
    at: '2026-08-15T08:35Z',
    title: 'The chest stops celebrating its second reel',
    notes: [
      'THE MIDDLE REEL ONLY FLARES WHEN IT MATCHES THE FIRST ONE now. That is the one thing two reels can say: the jackpot is still live.',
      'IT USED TO FLARE FOR TWO SYMBOLS OF THE SAME COLOUR TOO - two guns, or two systems. There are only two colours, so that happened on about half of all spins, and so did the long slow crawl of the third reel that comes with it. A machine that makes a fuss every other spin has taught you that the fuss means nothing.',
      'It now happens on about one spin in fourteen, and the third reel only drags when there is genuinely something to drag out.',
    ],
  },
  {
    at: '2026-08-15T08:02Z',
    title: 'THE SWARM - forty runners crossing the yard',
    notes: [
      'A THIRD SPECIAL EVENT. Forty Swarmers are set down off screen in one direction, and they come through at DOUBLE SPEED - faster than any mech on the roster.',
      'THEY ARE NOT CHASING YOU. Each one picks its own point in a small circle around where you were standing and runs at THAT, in a straight line, for twenty seconds. So the swarm arrives as a front with gaps in it rather than a column aimed at your head, and it pours through the space you are in and out the other side.',
      'THEN THEY TURN AROUND, and lose half their speed doing it. A thing that fast could never be outrun once it started actually following you, so the trade is fixed: terrifying while it ignores you, ordinary once it does not.',
      'They are yellow-tinged, they die fast - 60% of the usual hull - and there are enough of them that the ones you miss are the problem.',
      'IT IS SLIGHTLY MORE COMMON THAN THE RING ATTACK: about 2.4 swarms an average run against the ring\'s 2.0. The ring\'s odds are exactly what they were - the quiet rolls paid for the new event, not the ring.',
    ],
  },
  {
    at: '2026-08-15T07:51Z',
    title: 'Special Events: the ring can come for you at any time now',
    notes: [
      'EVERY WAVE NOW ROLLS FOR A SPECIAL EVENT TWICE - once as it begins and once thirty seconds in. The first wave never rolls; that one is still yours to settle into.',
      'THERE ARE TWO EVENTS SO FAR. Most rolls come up NOTHING. The other is the RING ATTACK - the ring of Heavies closing around wherever you happen to be standing, exactly as it was.',
      'IT USED TO BE AN APPOINTMENT. The ring arrived at 6:00 and again at 12:00, in every run, on every seed, forever. Now it can arrive at any wave but the first, at the top of it or half a minute in, and you will not know which run is the quiet one until it is over.',
      'THE ODDS ARE SET SO IT HAPPENS AS OFTEN AS IT DID: two rings in an average run. Measured over 40 full runs it came out at 1.8, and the spread is the point - six of those runs saw none at all, and one saw five.',
    ],
  },
  {
    at: '2026-08-15T07:13Z',
    title: 'Heavies walk faster and shrug off shells',
    notes: [
      'A HEAVY MOVES 10% FASTER. Still the slowest thing in the yard by a distance - it is a wall that walks, and it walks slightly less slowly now.',
      'AND IT TAKES HALF THE KNOCKBACK. Punting one out of your way used to be free: a Cannon shell threw it further than it walks in twenty seconds, so the ring you were meant to fight through could be swept aside instead. Half an impulse still moves it - this is not the Scraplord\'s outright immunity - a shell is just worth a shell now.',
      'It shoves the crowd exactly as hard as it did before. Only what your weapons do to it changed.',
    ],
  },
  {
    at: '2026-08-15T07:03Z',
    title: 'The Cannon has to turn its turret now',
    notes: [
      'THE CANNON TRAVERSES AT 90 DEGREES A SECOND, DOWN FROM 220. It used to swing far enough between shots that switching targets cost it nothing at all - it simply fired every time its cooldown came up, wherever the biggest thing happened to be standing.',
      'NOW IT HAS TO TRACK. It covers about 114 degrees between shots, and a target behind you is half a turn away - so a Cannon fighting a crowd spread all around the mech will miss shots that a Cannon facing a line never would.',
      'IT COSTS MOST WHEN THE GUN IS FASTEST. Its own fire-rate tiers shorten the gap between shots without speeding up the turret, so a finished Cannon covers only 80 degrees between them.',
      'Nothing else changed: same 44 damage a shell, same reach, same pierce at tier 7, and it still commits to the highest-HP enemy in range. The swing is also how you read that decision - now you get longer to see it.',
    ],
  },
  {
    at: '2026-08-15T00:19Z',
    title: 'A blast is strongest where it lands',
    notes: [
      'EXPLOSIONS NOW FALL OFF FROM THE CENTRE. A body standing on the impact point takes the full blast, one on the edge of the circle takes 40% of it, and everything between is on a straight line from one to the other. Until now a blast was a flat disc: a body at the very rim took exactly what a body at ground zero took.',
      'THIS IS HEAVY ARTILLERY\'S CHANGE, since it is the only weapon in the game with a blast. Landing a shell on top of a body still hurts it exactly as much as it always did - what has gone is the free damage to everything else standing inside the circle.',
      'THE EDGE IS STILL WORTH SOMETHING, deliberately. A blast whose rim did nothing would have a real radius smaller than the ring you can see, and the ring you can see should be the truth.',
      'It applies to any weapon with a blast, not just this one - there is one blast rule and every explosion in the game now follows it.',
    ],
  },
  {
    at: '2026-08-14T23:58Z',
    title: 'Every laser runs 25% cooler',
    notes: [
      'ALL FOUR LASERS GENERATE A QUARTER LESS HEAT. Nothing they hit for changes - the damage on every card is the number it always was - they simply spend more of a fight firing and less of it cooling.',
      'THE SHORT LASER NOW SPENDS MORE TIME ON THAN OFF: 46% uptime becomes 53%. The Medium goes 28% to 34%, the Long 19% to 24%. Over a long fight that is about 16% more damage out of all three, and the Long Laser gains the most because its heat bill was the steepest.',
      'THE HEAT TIERS SCALE WITH IT, so the cut holds at tier 7 rather than fading out: a maxed Short Laser goes from 49% uptime to 56%.',
      'WHY: with every weapon in the game held at tier 7, the four beams were taking a fifth of a run\'s damage between them while the four projectile weapons took four fifths. A volley bills a separate body per shell and gets better the more crowded the yard is; a beam burns one target and does not. Buying the beams SECONDS rather than bigger numbers is the half of that the ladder was already built around.',
    ],
  },
  {
    at: '2026-08-14T23:28Z',
    title: 'Cannon and Artillery rate tiers are percentages now',
    notes: [
      'THE CARDS SAY A PERCENTAGE INSTEAD OF A NUMBER OF SECONDS. The Cannon reads "cooldown -15%" and Heavy Artillery "reload -16.7%", which is exactly what those tiers were always worth - a fifteenth and a sixth of the weapon they were written for.',
      'WHAT IT FIXES: yesterday\'s 5% rate cut landed as 5% on a fresh gun and 7% on a finished one, because a tier that removes a fixed number of seconds removes a smaller SHARE of a longer cooldown. Both weapons now lose exactly 5% at every tier.',
      'The ladder is otherwise identical to the one these guns have always had: a tier-7 Cannon still fires at 0.70x its base cooldown and a tier-7 Artillery at two thirds of its reload, to the decimal.',
    ],
  },
  {
    at: '2026-08-14T23:22Z',
    title: 'Artillery and the Cannon both slow down',
    notes: [
      'HEAVY ARTILLERY HITS 5% SOFTER AND FIRES 5% LESS OFTEN: 58 damage a shell becomes 55.1, and the barrage rhythm goes from 3.6 seconds to 3.8. Its blast radius, its fuse and its tiers are all untouched.',
      'THE CANNON FIRES 5% LESS OFTEN. 1.20 seconds a shell becomes 1.26. Same 44 damage, same shell, same pierce - it just lays a little slower.',
      'BOTH CUTS BITE HARDER ON A FINISHED GUN than on a fresh one, because the tiers that speed these weapons up take off a fixed number of seconds rather than a percentage. A tier-7 Cannon loses 7% of its rate rather than 5%, and a tier-7 Artillery 7.3%.',
    ],
  },
  {
    at: '2026-08-14T23:10Z',
    title: 'Heavy Artillery drops two shells, not three',
    notes: [
      'A BARRAGE IS TWO SHELLS NOW. Tier 7 adds the third, where it used to add a fourth.',
      'Everything else is untouched: same 58 damage, same 75 unit blast, same 0.7 second fuse to read the markers by, same 3.6 second rhythm, and the blast and rate tiers all still do exactly what they say.',
      'So it opens with two shells where it used to open with three, and a finished one drops three where it used to drop four. A third less ground covered at tier 1, a quarter less at tier 7.',
    ],
  },
  {
    at: '2026-08-14T23:07Z',
    title: 'The Cannon reaches 5% less far',
    notes: [
      'THE CANNON GIVES UP 5% OF ITS RANGE, at every tier rather than only at the first: 260 becomes 247, and a finished Cannon reaches 371 instead of 390. Its two range tiers are worth 62 each now rather than 65.',
      'Nothing else about it moved - same shell, same damage, same rate of fire, same pierce at tier 7. It still commits to the highest-HP body it can see; it simply has to be slightly closer to see it.',
    ],
  },
  {
    at: '2026-08-14T22:13Z',
    title: 'Feed Systems now shortens the reload',
    notes: [
      'EVERY TIER OF FEED SYSTEMS TAKES TIME OFF YOUR RELOAD, on top of what it already did. All seven is 3.5 seconds.',
      'IT IS DELIBERATELY BACK-LOADED, harder than any other card in the game: 0.15s, then 0.2, 0.3, 0.4, 0.55, 0.7 - and then 1.2 for the seventh. The last tier is worth more than the first three put together, and finishing the card is the whole point of it.',
      'THIS IS THE MACHINE GUN CARD IT ALWAYS SHOULD HAVE BEEN. Rate of fire and a magazine fight each other: firing faster only empties the belt sooner, so the old card bought burst and quietly took your uptime away in exchange - 38% of the time firing became 29%. The seconds are what buy it back.',
      'Measured: a fresh Machine Gun goes from 46 to 63 damage a second with the card finished, up from 52 before this change. A tier-7 Machine Gun goes from 136 to 200, and for the first time its uptime goes UP rather than down as you invest - 49% to 50%, on a belt that now runs 7 seconds against a 7-second reload.',
      'No other weapon has a magazine, so nothing else notices.',
    ],
  },
  {
    at: '2026-08-14T21:43Z',
    title: 'The whole Chain Laser is drawn, not just its far end',
    notes: [
      'THE CHAIN IS ONE UNBROKEN RUN OF LIGHT AGAIN, from the muzzle through every body it jumps to. What you were seeing - a loose beam out in the crowd with nothing joining it to the mech - was the last jump on its own: the beam layer only ever kept ONE segment per weapon, so each jump painted over the one before it and only the final link survived to be drawn.',
      'The simulation was chaining correctly the whole time; the damage always landed where the beam should have been. This was the picture disagreeing with the game.',
      'Each link now carries its own travelling energy, offset link by link, so the light visibly runs outward through the crowd. The muzzle flash stays at the muzzle and the debris still comes off the first body, because ten links spitting sparks would bury the horde they are drawn over.',
    ],
  },
  {
    at: '2026-08-14T21:19Z',
    title: 'One reroll a run',
    notes: [
      'EVERY RUN NOW STARTS WITH ONE REROLL. A button under the cards deals a fresh three from the same pool, and the level-up is still owed afterwards - a reroll is not a pick.',
      'ONE, FOR THE WHOLE RUN. It is not a way to never see a card you dislike; it is a decision about which level-up is worth spending it on. The button says how many you have left and disappears when you have none.',
      'It will not fire once there is nothing left to fit - the two salvage cards are all that remains at that point, so a reroll there would take your last one and hand back what you already had.',
      'THE PAUSE MENU HAS AN INFINITE REROLLS SWITCH. It is a cheat, it is remembered between runs, and throwing it mid-run works on the card you are looking at.',
    ],
  },
  {
    at: '2026-08-14T21:05Z',
    title: 'A level-up always has something on it',
    notes: [
      'ONCE THERE IS NOTHING LEFT TO FIT, a level-up now pays out anyway: a FIELD REPAIR that patches a tenth of your hull, or SALVAGE RIGHTS for a handful of credits. Two cards, every time, for the rest of the run. It used to hand you the level in silence, which looked exactly like the game forgetting to give you your level-up.',
      'A CYBER CHEST DOES THE SAME. An empty pool pays a repair and some credits rather than opening on nothing.',
      'A LEVEL-UP WITH ONLY ONE OR TWO THINGS TO OFFER now shows one or two cards. The empty slots used to keep whatever was on them last time, so a card you had already taken sat there looking pickable.',
    ],
  },
  {
    at: '2026-08-14T21:05Z',
    title: 'The Chain Laser starts at the mech, and a tier 8 chest shows its reels',
    notes: [
      'THE CHAIN NOW ALWAYS HANGS OFF THE MECH. If the body it was burning dies in the same instant, the chain stops there and the laser picks a fresh target on the next shot instead of leaving a beam floating in the crowd.',
      'A CHEST THAT IS GIVING A TIER 8 SPINS PROPERLY. The reels roll through the ordinary symbols like any other chest and all three settle on the tier 8 - it was showing three identical symbols flickering past, which gave the answer away before the first reel landed.',
    ],
  },
  {
    at: '2026-08-14T19:55Z',
    title: 'Laser icons wear their own beam colour',
    notes: [
      'The four laser symbols are now the colour of the light they fire: the Short Laser green, the Medium and Chain Lasers blue, the Long Laser red. On a spinning reel the symbol is now the same colour you have been staring at all run.',
      'They were three amber bars that differed only in length, which is a fine way to tell them apart standing still and a poor one at speed.',
      'The tile border still says gun or system, in amber and blue, because that is how you read a chest payout off the reels before the word turns up. The border says which pool, the symbol says which weapon.',
    ],
  },
  {
    at: '2026-08-14T19:43Z',
    title: 'TIER 8: the Medium Laser becomes the Chain Laser',
    notes: [
      'MOST WEAPONS ARE GOING TO GET A TIER 8, and no level-up will ever offer one. A tier 8 needs the weapon finished at tier 7 AND a specific passive in your build - and then it can only come out of a Cyber Chest.',
      'WHEN A CHEST CAN GIVE YOU ONE, IT DOES. The reels do not spin for a haul: all three land on the tier 8 and that is the whole chest. There was never anything else it could have been, so the machine does not pretend there was.',
      'THE FIRST ONE IS THE MEDIUM LASER, and it needs Targeting Optics. Take the laser to tier 7, hold Optics at any tier, and the next boss chest turns it into the CHAIN LASER.',
      'THE BEAM JUMPS. From whatever it is burning it reaches the nearest enemy not already in the chain, and keeps going for as long as the whole beam still fits inside its range. Range stops meaning “how far can it reach” and starts meaning “how much beam is there” - which is why Optics is the price. Every unit of reach it buys is more beam to jump with.',
      'It keeps everything the Medium Laser had at tier 7, plus a little more heat dispersion and a little more range.',
      'Measured against the real horde: a tier-7 Medium Laser with maxed Optics does 34 damage a second. The Chain Laser with the same Optics does 84.',
    ],
  },
  {
    at: '2026-08-14T18:01Z',
    title: 'Fuel barrels survive anything you cannot see',
    notes: [
      'A drum is now immune to everything while it is off screen. Nothing you fire can break one you are not looking at.',
      'This is a cheat, and it is on your side. A barrel broken off screen is worse than a barrel left standing: the drum is spent and whatever fell out of it lands somewhere you will never walk. Plenty of things reach past the edge of the picture - a Long Laser with Targeting Optics is a 710-unit beam, the artillery lands on ground you are not watching, and a missile rack fires wherever you last ran.',
      'Measured over a full run, TWO THIRDS OF EVERY BARREL BROKEN was going up out of sight - 29 of 41 on one seed, 30 of 46 on another, with the furthest at 1412 and 1545 units against a screen that reaches 501. None of them paid out. That is about thirty drums a run handed back to you.',
      'The number you break in front of you is unchanged. You simply stop burning the rest of the yard by accident.',
    ],
  },
  {
    at: '2026-08-14T17:57Z',
    title: 'The stick works after a chest, and the reels take their time',
    notes: [
      'THE JOYSTICK USED TO DIE THE MOMENT YOU COLLECTED A CHEST, and stayed dead for the rest of the run unless you paused and unpaused. The stick is put away while the reels spin and was only ever brought back by a check the chest could not reach - so it never came back. It is now driven by whether the game is actually running, which cannot get out of step.',
      'THE FIRST CHEST OF A RUN NO LONGER HITCHES. Its icons were being fetched for the first time in the same instant the reels started turning; they are loaded up front now, so the first spin is as smooth as the seventh.',
      'THE SPIN IS MUCH LONGER: twice as long on the first two reels and three times on the last, which with the anticipation crawl makes a live jackpot over six seconds of reel. The strips grew with the timing rather than the reels just slowing down - they travel further, at the same speed, for longer.',
      'AND THE SIEGE RING HAS NO GAP IN IT. A Heavy that would have landed in a wreck was being shoved outward to clear it, which left a hole in the ring exactly where a body should have been. They stand in the wreck now and walk out of it, and the circle stays a circle.',
    ],
  },
  {
    at: '2026-08-14T17:45Z',
    title: 'Heavies look like Heavies, and the ring lands closer',
    notes: [
      'A HEAVY IS GREY NOW. Its faction paint is knocked back and cooled, so a Heavy standing next to the same hull in blue or orange reads as unpainted steel rather than as a slightly larger version of the thing beside it. It is a tinge, not a repaint - you can still tell exactly what chassis it is.',
      'THE SIEGE RING IS TIGHTER: 520 units out instead of 560. That is as close as it can be set down and still be something you turn around and find rather than something you watch arrive - the camera can see 501 units into the corner of the screen, and no further.',
      'And a ring sprung with your back to the fence now leaves the wall empty instead of stacking bodies against it. The fifty close up into the arc that fits, so you get a protected flank and a denser wall in front of you. Cornered, the ring simply sets down further out to make room.',
    ],
  },
  {
    at: '2026-08-14T17:14Z',
    title: 'Everything in the yard moves a quarter slower',
    notes: [
      'Every enemy in every wave had its speed cut by 25%. The fastest thing in the game - a Prowler at the end of wave 4 - drops from 101 units a second to 75, against a mech that does 195. The last wave now closes at 53.',
      'One factor across the whole ladder, so the shape of it is untouched: a Scavenger is still 22% quicker than a Rustling, a Hauler still drops 20% below the Scavenger, and speed still rises and falls from wave to wave instead of climbing. What changed is the pace of the game, not the relationship between the waves.',
      'The elites, the bosses and the Heavies all inherit the cut, since each of them is a multiple of its wave.',
    ],
  },
  {
    at: '2026-08-14T16:44Z',
    title: 'The siege: fifty Heavies close in at 6:00 and 12:00',
    notes: [
      'At the top of wave 4 and wave 7, fifty HEAVY units are already standing in a ring around you when the wave turns over. You do not see them arrive - the ring is set down at 560 units, just past what the camera can reach - so they are simply there, all the way round, when you next look outward.',
      'A HEAVY HAS TEN TIMES THE HIT POINTS OF AN ORDINARY ENEMY AND MOVES AT A TWENTIETH OF THE SPEED. Wave 4’s are 660 hit points at under 5 units a second; wave 7’s are 1720 at under 4. They are walls that walk. Stand still and the ring takes about two minutes to close on you.',
      'They cannot turn up any other way. Heavy is the one variant the director cannot roll - it will never appear in the ordinary horde, on an elite, or on a Scraplord. The only Heavies in a run are the hundred from these two moments.',
      'The ring stands shoulder to shoulder without ever overlapping, and it bulges outward around a wreck rather than pinching in.',
      'While the ring is around you the yard sends fewer ordinary enemies - the director counts what is already near you before it opens the tap, and fifty bodies is a lot to count. Waves 4 and 7 are quieter and much heavier than they were.',
    ],
  },
  {
    at: '2026-08-14T15:34Z',
    title: 'Twice as many fuel barrels in the yard',
    notes: [
      'A Scrapyard now opens with about sixty drums instead of about thirty.',
      'And it opens with just as much of everything else. The extra barrels are ADDED to the yard rather than taken out of the wrecks and the girders - there is simply more scrap standing in it now, not the same scrap with more of it flammable.',
    ],
  },
  {
    at: '2026-08-14T15:25Z',
    title: 'The yard restocks its fuel barrels',
    notes: [
      'Barrels used to be a fixed allowance handed out when the level was built, and a broken one was gone for good. Since the scrap does not move, ground you had cleared stayed cleared - so the back half of a run was played in a yard with no drums left anywhere you had been, and the whole mechanic quietly stopped existing partway through.',
      'One broken drum now stands back up somewhere every eighteen seconds of play. Always at least 560 units away, which is past what the camera can see: a barrel is never seen appearing, it is always something that was already there when you arrived.',
      'It comes back where a barrel already stood, so the yard can never hold more drums than it opened with. This restocks the Scrapyard; it does not turn it into a barrel farm.',
      'Measured over a full run, this roughly triples how many barrels a player gets through - 33 broken instead of 13 on one seed, 29 instead of 10 on another - and the number standing holds steady all run instead of draining away.',
    ],
  },
  {
    at: '2026-08-14T15:17Z',
    title: 'Elites and bosses keep the health, give back the damage',
    notes: [
      'They stay exactly as tough as they were made an hour ago - an elite has double the hit points and a Scraplord has triple - but their contact damage goes back to what it has always been.',
      'A last-cycle boss was hitting for 145 against a 120 hull, which is a one-shot kill from full health that even a maxed Ablative Plate could not turn into a survivable hit. It is 48 again: three hits, which is a mistake you can read and recover from.',
      'A last-cycle elite goes from 66 to 33 for the same reason.',
      'So the two numbers now do different jobs. Health is how long the fight lasts. Damage is how badly touching the thing goes. Making a boss last three times as long is a bigger fight; making it hit three times as hard was a different game.',
    ],
  },
  {
    at: '2026-08-14T15:07Z',
    title: 'The Scrapyard is won at sixteen minutes with the yard clear',
    notes: [
      'The run is a minute longer - 16:00, which is exactly the eight cycles the ladder authors.',
      'AND THE CLOCK ALONE NO LONGER ENDS IT. You win when the timer has passed 16:00 and there is no Scraplord left alive anywhere in the yard. The last one walks in at 15:30, so the ordinary way a run finishes is now: the timer runs out, nothing happens, and the thing standing between you and the end of the run is the thing you are already fighting.',
      'EVERY boss counts, not just the most recent. One you ran away from at six minutes is still out there and still enormous, and the run will not end until it is dealt with. The arrow on the edge of the screen is how you find it.',
      'Only bosses. The horde never stops arriving, so a yard full of regulars is not what is holding you.',
    ],
  },
  {
    at: '2026-08-14T15:00Z',
    title: 'Twice the horde, and the big things hit like it',
    notes: [
      'TWICE AS MANY REGULARS around you, at every point in a run. The yard used to hold about 14 bodies’ worth of pressure near you in the first cycle and 45 by the last; it is 28 and 91 now. Measured with the reference bot, the peak headcount went from about 40 to about 75.',
      'ELITES ARE TWICE AS STRONG - double the hit points and double the contact damage.',
      'BOSSES ARE THREE TIMES STRONGER, on both. A first-cycle Scraplord has 924 hit points and the last one has 9450.',
      'Speed is untouched on both, which is the only reason this is survivable: a boss with three times the health is still the slowest thing on the field and still a place on the map rather than something that chases you down.',
      'XP is untouched too, so an elite is now twice the work for the same payout and a boss three times. That is a real change to what those fights are worth and it may not survive contact with a few runs.',
      'AN ARROW POINTS AT A BOSS YOU CANNOT SEE. While a Scraplord is alive and off screen, a blue pointer sits on the edge of the picture showing which way it is. It disappears the moment the boss is actually in view.',
    ],
  },
  {
    at: '2026-08-14T14:46Z',
    title: 'The game has a front door, and a name on it',
    notes: [
      'SCRAPYARD SURVIVORS. There is a title screen now, and the game opens on it instead of dropping you into the mech picker.',
      'NEW GAME runs mech, then yard. Picking a chassis is “Next” rather than “Deploy”, because there is a step after it, and every screen in the flow has a Back.',
      'CHOOSE A YARD is the new step. Scrapyard is the one you can play. Mossy Mayhem is on the card next to it, greyed out and marked TBD - something green and overgrown, not built yet.',
      'SETTINGS, off the title. Performance mode renders at half resolution for a struggling phone, and the debug readout is a switch rather than a URL only I knew about. The changelog you are reading lives here too, as well as in the pause menu.',
      'UPGRADES, off the title, and it is honest about being empty: it shows what you have banked and says plainly that nothing spends it yet. That is the screen the credits have been piling up for.',
      'Abandoning a run now returns to the title rather than the mech picker. Quitting a run is not the same as starting another one.',
    ],
  },
  {
    at: '2026-08-14T14:11Z',
    title: 'Percentages add up instead of multiplying together',
    notes: [
      'Two +60% bonuses to the same stat are +120%. They used to be +156%, because your chassis bonus was multiplied by your cards rather than added to them.',
      'Cards already worked this way with each other - it was the CHASSIS that compounded. Slate’s medium-laser cooling with a maxed Feed Systems was x2.25 and is now x2.0; Moss’s doubled Short Laser reach with a maxed Targeting Optics was x3.0 and is now x2.5; Ember’s Long Laser with a maxed Ordnance was x1.95 and is now x1.8.',
      'So a chassis bonus is worth the same whether you are five minutes in or fifteen, instead of quietly growing more valuable the more cards you stacked behind it.',
      'Reductions fold the same way and now stack harder for it: Ash’s faster rearm with a maxed Feed Systems goes from x0.53 to x0.47 of the base reload.',
    ],
  },
  {
    at: '2026-08-14T13:55Z',
    title: 'Ordnance makes lasers run hot',
    notes: [
      'A laser that hits harder now heats faster to match, exactly the way its own damage tiers already did - the same +50% on the Short Laser as on the Long one, each measured against its own heat.',
      'Ordnance was the one way in the game to get laser damage with no heat bill, which made it strictly better on a beam than the beam’s own damage rungs. On a laser it now buys a harder burst rather than a bigger total, and you buy the burst back with heat capacity and dispersion - the trade the lasers were built around.',
      'Every other weapon is unchanged. Shell-throwers do not heat, so there is nothing there to raise.',
    ],
  },
  {
    at: '2026-08-14T12:39Z',
    title: 'The chest reels actually spin now',
    notes: [
      'They never did. The machine snapped straight to its answer the moment the chest opened, so every spin in the game so far has been three symbols appearing at once. They turn now - fast, then braking hard onto the symbol, stopping left to right.',
    ],
  },
  {
    at: '2026-08-14T12:39Z',
    title: 'The slot machine tells you where you stand while it is still spinning',
    notes: [
      'Each reel now lands with a weight chosen from what that landing MEANS, and the three of them are different beats.',
      'REEL ONE just stops. One symbol on its own tells you nothing about the haul, so it gets the plain thump every time - it is the baseline you read the other two against.',
      'REEL TWO is about what is still LIVE. Match the first reel and the jackpot is still on the table: the biggest reaction in the machine. Match only its colour and the same-type haul is still alive: a smaller one. Match nothing and it lands flat, because nothing is being built to.',
      'AND THEN THE LAST REEL CRAWLS. When reel two leaves something alive, reel three takes almost a second longer to arrive, dragging over the final symbols while the whole frame pulses. Nothing left alive, no crawl - a machine that draws out every spin teaches you to stop watching.',
      'REEL THREE IS WHERE THE FUSS IS, and it is sized to the prize. A rare haul lands blazing and the whole frame lights up behind the payout. A jackpot does that and kicks the machine as well. A one-power-up spin gets the same plain thump reel one got, because that is what it is worth.',
      'The landing flash is the colour of what it landed on: amber for a gun, blue for a system.',
      'All of it is off if your phone is set to reduce motion.',
    ],
  },
  {
    at: '2026-08-14T12:11Z',
    title: 'Enemies never stop dropping XP',
    notes: [
      'Kills late in a run were leaving nothing on the ground. Gems only ever leave the yard when you pick them up, so the ones you walked past at three minutes were still lying there at twelve - and once enough of them had piled up, every new kill quietly poured its XP into some gem in a corner you were never going to visit.',
      'Now the field makes room instead. When it is full, the OLDEST gem out there is recycled into whichever gem is nearest to it, and the kill in front of you drops a real gem as normal. Abandoned corners of the yard collapse into fewer, richer gems; nothing is ever lost.',
      'The field also holds more: 500 gems, up from 400.',
      'A boss killed while the field was full used to leave no Cyber Chest at all. It always leaves one now.',
    ],
  },
  {
    at: '2026-08-14T11:44Z',
    title: 'Chest reels show your own loadout, and pay out in it',
    notes: [
      'The reels no longer carry the whole arsenal. They show what YOU are running - every upgrade you hold and have not maxed - so two Long Lasers and a Servo Drive is a sentence about your build rather than a wall of symbols you have never seen.',
      'EVERY POWER-UP NOW COMES OFF THE REELS. The payout is dealt across the three of them in order: a jackpot of three Medium Lasers is five tiers of Medium Laser, a pair paying four is A, B, A, A. Nothing is topped up from outside any more.',
      'So a chest deepens the run you committed to rather than handing you something new. Breadth comes from level-up cards, which are a choice; depth comes from bosses, which are a fight.',
      'A symbol that hits tier 7 part way through a payout passes its share to the next reel.',
    ],
  },
  {
    at: '2026-08-14T11:16Z',
    title: 'Bosses drop a Cyber Chest',
    notes: [
      'Kill a boss and it leaves a chest behind. Walk onto it and the yard stops dead while three reels spin.',
      'The reels carry an icon for every weapon and every passive - amber for guns, blue for systems - and they only ever land on something you can actually take.',
      'WHAT YOU GET IS WHAT YOU SPUN. Three of a kind pays five power-ups; a pair with a third of the same colour pays four; a pair pays three; three different symbols of the same colour pay two; anything else pays one. The symbols you watched land are the first upgrades you receive.',
      'Each power-up is a full level-up card applied on the spot - a new gun, a tier on one you carry, a passive. You do not choose them. That is the trade: a chest gives you more than a level-up ever will, and gives you no say in it.',
      'Every boss drops one, every time. There are seven bosses in a run.',
    ],
  },
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
