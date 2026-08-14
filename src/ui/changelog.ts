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
