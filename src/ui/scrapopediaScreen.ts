/**
 * THE SCRAPOPEDIA - what every gun and every system actually does, read from the title screen.
 *
 * ---------------------------------------------------------------------------------------------
 * WHY IT EXISTS, GIVEN THE CARDS
 * ---------------------------------------------------------------------------------------------
 * A level-up card is read in about four seconds with a horde closing in, which is why its text
 * carries no numbers and says what happens rather than how much (data/upgrades.ts). That is the
 * right trade at that moment and the wrong one everywhere else: the single most confusing thing in
 * this game is that every weapon picks its target by a DIFFERENT RULE, and a card has no room to
 * say so. The Cannon insists on the biggest thing in range while the Machine Gun finishes the
 * smallest; the missile racks do not aim at all and fire where you last MOVED; the artillery does
 * not even look at the horde.
 *
 * None of that is discoverable from a card, all of it changes how you play, and this is the screen
 * with time to explain it.
 *
 * ---------------------------------------------------------------------------------------------
 * IT NEVER RESTATES A NUMBER, AND IT NEVER RESTATES A CARD
 * ---------------------------------------------------------------------------------------------
 * The same rule the cards follow applies here: no magnitudes, only counts of projectiles. A
 * reference screen is exactly where the temptation to print the whole stat block lives, and a
 * stat block is the thing most likely to go quietly stale.
 *
 * For the same reason the description and the tier ladder are READ FROM UPGRADE_CATALOG rather
 * than retyped. The only text this file owns is the part the catalog has no room for - how the
 * weapon chooses what to shoot, and what that costs you. If a card's wording changes, this screen
 * changes with it; if a weapon's ladder is reordered, this screen reorders too.
 *
 * ---------------------------------------------------------------------------------------------
 * IT ONLY SHOWS WHAT YOU HAVE ACTUALLY HELD
 * ---------------------------------------------------------------------------------------------
 * A system's page appears once that card has been TAKEN, a chassis' page once that chassis has been
 * EARNED, and an enemy's page once you have KILLED one. An empty save opens on two entries: Slate,
 * and the Medium Laser it walks in holding.
 *
 * That makes this a record rather than a catalogue, and it is worth being clear about what it
 * costs, because it cuts against the section above: a player cannot read how the artillery aims
 * before deciding whether to take it. The manual is the reward for having played, not the briefing
 * before you do - and the tension is real rather than an oversight.
 *
 * IT GATES THIS SCREEN AND NOTHING ELSE. The level-up deck keeps offering all fourteen cards
 * whatever is unlocked; see `Settings.unlockedUpgrades`. A screen that could not be filled in
 * except by a deck that would not offer what filled it is a screen that stays empty forever.
 *
 * The index is therefore REBUILT ON EVERY `show()` rather than once in the constructor. Between two
 * visits the player has usually finished a run, and a manual that needed the app restarted before
 * it admitted what you found would be worse than no manual.
 *
 * ---------------------------------------------------------------------------------------------
 * IT DOES NOT MENTION TIER 8 UNTIL YOU HAVE HELD ONE
 * ---------------------------------------------------------------------------------------------
 * An ascension is the one thing in this game that is meant to be FOUND. This screen used to print
 * a "Tier 8" section on the weapon that has one - its name, what it does, and the exact recipe -
 * and a note on Targeting Optics explaining what it was really for. Between them a player who
 * opened the manual once knew the whole secret before ever finishing a weapon. So that went.
 *
 * An ascension now gets a page of ITS OWN, behind the same gate every other entry sits behind:
 * shown once you have actually held the thing. Until then the screen is exactly what it was - no
 * entry names an ascension, its own parent weapon's page included, and nothing hints that there is
 * a height above tier 7 at all.
 *
 * A SEPARATE ENTRY AND NOT A SECTION ON THE WEAPON, which is the part worth being deliberate
 * about. A tier 8 renames the gun, redraws its icon and rewrites what it does; folding that into
 * the parent's page as a footnote would file the most dramatic thing in the game under the card it
 * stopped being. It is also what keeps the secret: a "Weapons 4/9" counter that silently became
 * "4/10" the day an ascension existed would announce it to a player who had found nothing.
 *
 * THE GROUP DOES NOT EXIST UNTIL IT HAS A MEMBER. Every other group on this screen prints
 * `found / total`, and a total is exactly the leak this screen was rewritten to close - "0 / 9"
 * tells a new player both that ascensions exist and how many to go looking for. So the heading is
 * not rendered at all until the first one is held, and from then on it behaves like every other
 * group, because by then the secret is one they own.
 *
 * ---------------------------------------------------------------------------------------------
 * THE MECHS ARE HERE TOO, AND THEIR TEXT IS THE PICKER'S OWN
 * ---------------------------------------------------------------------------------------------
 * `HeroDef.identity` is already the one line that describes a chassis, written for the mech select
 * screen. This page shows THAT STRING rather than a second description written beside it: two
 * descriptions of one chassis is two things to keep true, and the one nobody is looking at is the
 * one that goes stale.
 *
 * The consequence is worth knowing: those lines still carry percentages, because a chassis bonus
 * is not an upgrade card and was not part of stripping the numbers out of the deck. If they should
 * read like the rest of this screen, `identity` is the single place to change - and changing it
 * fixes the picker at the same time.
 *
 * ---------------------------------------------------------------------------------------------
 * THREE LEVELS, ONE OVERLAY
 * ---------------------------------------------------------------------------------------------
 * SECTIONS -> INDEX -> PAGE. It opens on four buttons; each opens a list; each entry opens a page.
 * Back walks exactly one step and never more, so the button means one thing everywhere.
 *
 * Three panes in the same element rather than three overlays, so "which is showing" is one
 * variable and the screen cannot end up displaying two of them or none.
 *
 * IT DID NOT USED TO HAVE THE SECTION MENU. Everything was one scrolling index, which was fine at
 * fourteen entries and stops being fine the moment ENEMIES and ACHIEVEMENTS join - four unrelated
 * kinds of thing on one list is a list nobody reads to the bottom of.
 */

import {
  ACHIEVEMENT_CATALOG,
  FLAVOURS,
  LEVEL_CATALOG,
  HERO_CATALOG,
  RANKS,
  UPGRADE_CATALOG,
  weaponNameAtTier,
  type AchievementDef,
  type AchievementId,
  type FlavourDef,
  type HeroDef,
  type HeroId,
  type RankDef,
  type UpgradeDef,
  type UpgradeId,
} from '../core/index.js';
import { spriteUrl } from '../render/assets.js';
import { bestiaryIconScale } from '../render/creatureArt.js';
import { bestiaryFor, type BestiaryEntry } from '../bestiary.js';

/**
 * The part the catalog cannot say. Keyed by card id so a new card is a compile error here rather
 * than a silently blank page.
 *
 *   aims   HOW IT CHOOSES. The single most useful sentence about any weapon in this game.
 *   notes  what follows from that - the cost, the quirk, the thing that surprises people.
 */
interface ManualEntry {
  readonly aims: string;
  readonly notes: readonly string[];
}

const MANUAL: Readonly<Record<UpgradeId, ManualEntry>> = {
  'w-cannon': {
    aims: 'The HIGHEST-HP enemy in range. Not the nearest - the biggest.',
    notes: [
      'It commits. The turret swings onto whatever it has chosen and holds fire until it is laid on, so a target behind you costs shots while the barrel comes round. Watching where the barrel goes is how you know what it has decided.',
      'The thing with the most hit points is usually at the BACK, behind the chaff that is actually biting you. That is the whole geometry of the weapon: the shell travels through the crowd to reach it, which is why punching through an extra body matters so much once it can.',
      'One heavy shell at a time, and it shoves what it hits. Nothing else in the yard moves a body the way this does.',
    ],
  },
  'w-mortar': {
    aims: 'The THICKEST KNOT of enemies inside a cone in front of the barrel.',
    notes: [
      'It looks straight ahead first. A narrow cone off the barrel, and if there is a crowd in it that crowd is the target - whatever is happening elsewhere on the field. Only when the cone is empty does it open up, fifteen degrees at a time, until it finds something.',
      'So it is a gun you AIM WITH THE WHOLE MECH. Point the chassis at the horde and it hammers the horde; turn away and it hunts for the next thing worth a shell. Nothing else in the yard cares which way you are facing except the missile racks, and they only care where you were MOVING.',
      'The shell is the Heavy Artillery’s: the damage is the blast and there is no direct hit worth the name. The difference is that this one is thrown AT something. The barrage does not care where the enemies are, and this does nothing else.',
      'It shares the Cannon’s mount, and the two can never be carried together. A run picks the biggest body or the biggest crowd.',
    ],
  },
  'w-laser-short': {
    aims: 'The WEAKEST enemy in range - it finishes rather than starts.',
    notes: [
      'A beam burns continuously into one body until that body dies or leaves. There is no shot to miss and no travel time; if the line is clear, the damage is already landing.',
      'Scrap blocks it. A beam refuses a shot it cannot make cleanly rather than firing into a wreck, which also means it is not paying heat for nothing.',
      'The shortest reach of the four, so it only works if you are willing to be close.',
    ],
  },
  'w-laser-medium': {
    aims: 'The WEAKEST enemy in range - it finishes rather than starts.',
    notes: [
      'A beam burns continuously into one body until that body dies or leaves. There is no shot to miss and no travel time; if the line is clear, the damage is already landing.',
      'Scrap blocks it, and it runs hot for what it does. Heat is the whole limiter on every laser: fire until it cuts out, then wait while it sheds.',
      'The middle of the three: reaches further than the short laser, cools better than the long one, and is the beam you take if you do not want to build the run around it.',
    ],
  },
  'w-laser-long': {
    aims: 'The WEAKEST enemy in range - it finishes rather than starts.',
    notes: [
      'A beam burns continuously into one body until that body dies or leaves. There is no shot to miss and no travel time; if the line is clear, the damage is already landing.',
      'The longest reach in the game, and the steepest heat bill to go with it. It fires in short bursts and spends most of a fight cooling, so what it is really buying you is the right to pick a target from a long way off.',
      'Scrap blocks it, and at this range there is a lot of scrap between you and the far end of the beam.',
    ],
  },
  'w-missile-short': {
    aims: 'NOTHING. The rack fires along the direction you last MOVED.',
    notes: [
      'This is the weapon that makes running a decision. It has no turret and picks no target - the volley leaves along your own heading, so kiting backwards means firing backwards, and turning to face something is how you aim it.',
      'Once away, each missile steers weakly toward whatever body happens to be nearest to ITSELF, re-judged the whole way. So they fan out and find their own victims rather than converging on one.',
      'Two warheads at a time, slow to rearm, and each one hits hard enough to matter.',
    ],
  },
  'w-missile-long': {
    aims: 'NOTHING. The rack fires along the direction you last MOVED.',
    notes: [
      'Same rule as the short rack: no turret, no target, the volley goes where you were going. Turning to face something is how you aim it.',
      'Weaker homing than the short rack and a much longer fuse, so these travel a long way before they come down. They are the rack you fire into ground you have not reached yet.',
      'Three missiles to start with, and a finished rack throws five.',
    ],
  },
  'w-machine-gun': {
    aims: 'The WEAKEST enemy in range, very close in.',
    notes: [
      'The shortest reach of any weapon here. It only does anything at all when you are inside the crowd, which is exactly where its magazine is most likely to run dry.',
      'A magazine is the third kind of limiter in the game and the one that hurts. A cooldown paces you evenly and heat trades burst against silence every few seconds; a belt gives you a long uninterrupted stream and then takes the weapon away entirely. Every round is a slice of that silence you have already bought.',
      'It fires two rounds at a time at the lowest-HP body it can see, which makes it a finisher - it cleans up what the heavier guns leave standing.',
    ],
  },
  'w-flak-cannon': {
    aims: 'The NEAREST enemy - and then sprays past it.',
    notes: [
      'Three shells a burst, each one thrown down its own randomly drawn line inside a wide cone. It is the only weapon here that cannot be aimed: two bursts at the same body are never the same shape, and no tier narrows the spread.',
      'It reaches further than any other shell in the game and hits almost nothing at that distance. What it is really firing at is the GROUND BEHIND its target - it shoots the nearest body so the cone opens into whatever is walking up behind it, which is why a wave eats a whole burst and a single straggler eats one shell of it.',
      'It shares the Machine Gun\u2019s mount, and the two can never be carried together. A run picks the stream or the spray.',
      'Vermilion throws a fourth shell every burst \u2014 a denser spray out of the same belt, which empties that much sooner for it.',
      'A magazine, like the belt gun: a long stretch of fire and then a long silence you have already paid for.',
    ],
  },
  'w-drone': {
    aims: 'The BAY aims at nothing. Each DRONE picks the nearest thing to ITSELF.',
    notes: [
      'It is a factory, not a gun. Every thirty seconds it finishes a drone, and the drone does the rest - so the card does nothing at all for the first half minute you hold it.',
      'A drone flies escort until something comes within twice its reach, then goes and circles THAT and empties a machine gun into it. When the target dies it comes home, picking up anything it passes on the way. It hunts from where it is STANDING, not from where you are, so a drone already out on a kill will chain across a crowd without ever coming back.',
      'It will not chain forever, though. Nothing more than about two screens from YOU is a target, however close it happens to be to the drone - so a spread-out wave cannot walk your drones off the edge of the fight.',
      'ITS MAGAZINE IS ITS LIFE. There is no reloading - when the last round is gone it detonates, and the blast is worth about as much as one artillery shell. A drone is a thing you spend, not a thing you keep.',
      'Finish the bay and four fly at once. It also keeps building at full strength: one finished drone is held in reserve, so a loss is replaced the instant it happens.',
    ],
  },
  'w-phase-cannon': {
    aims: 'The enemy with the DENSEST CROWD packed around it - even one behind a wall.',
    notes: [
      'The bolt is untouchable in flight. It passes through every enemy, wreck and wall between you and its mark, lands on that one body, and bursts into everything standing around it. Nothing on the way in is hit; the crowd at the arrival point is.',
      'It is the only gun in the game that does not care about line of sight. Every other weapon refuses or wastes a shot at something behind cover; this one picks the knot of bodies on the far side of the rock wall and reaches it.',
      'The catch is the turret: the slowest slew in the yard. The bolt cannot miss once fired, so the fight is getting the barrel around in time - a crowd forming behind you is seconds of traverse away, and where you stand decides how much of that you pay.',
      "A mark that dies before the bolt arrives does not save its friends: the bolt keeps flying and bursts at the end of its run anyway.",
    ],
  },
  'w-artillery': {
    aims: 'NOTHING AT ALL. Shells fall on random ground near you.',
    notes: [
      'It is the only weapon that never consults the horde. It does not pick a target, it does not need one, and it will happily bombard an empty yard. Think of it as weather you fight underneath rather than a gun you fire.',
      'Shells land in a ring of ground around you - past the bodies actually touching you, onto the ground the next wave is crossing. You cannot aim it, but you can decide where you are standing when it lands.',
      'THE FUSE IS THE WEAPON. A marker sits on the ground before each shell arrives, which is time enough to read it and choose whether to walk into that circle or away from it. The blast is strongest at the centre and weakest at the rim.',
    ],
  },
  'p-range': {
    aims: 'Every weapon reaches further.',
    notes: [
      'Reach decides what a weapon can even consider shooting, so this is worth most to the guns that are starved of targets and least to the ones already swimming in them.',
      'It does nothing for the missile racks, which fire whether or not anything is in range - but it is worth a great deal to a short-ranged gun that spends its life waiting for something to walk into it.',
    ],
  },
  'p-damage': {
    aims: 'Every weapon hits harder.',
    notes: [
      'The straightforward one, and it applies to everything you are holding at once.',
      'It costs the lasers something. Raw power on a beam runs it hotter - that is the trade the whole laser ladder is built around - so this makes them hit harder and cut out sooner. Capacity and dispersion are how you buy that back.',
    ],
  },
  'p-rate': {
    aims: 'Everything fires more often.',
    notes: [
      'Three limiters, three effects: shorter cooldowns for the guns, faster heat dispersion for the beams, and a quicker reload for anything with a magazine. Whatever you are holding, some part of this card is doing something.',
      'Careful with a magazine weapon: firing faster empties a belt sooner, so the rate on its own gives back in silence what it bought in burst. The reload half is what actually makes it worth taking there.',
    ],
  },
  'p-speed': {
    aims: 'The chassis moves faster.',
    notes: [
      'It raises how fast you can go AND how fast you get there, so the mech feels the same and is simply quicker. A higher top speed on its own would just make it float.',
      'Everything in this game is downstream of being able to leave: the horde is escapable by walking, gems have to be walked onto, and the missile racks fire wherever you are heading.',
    ],
  },
  'p-armour': {
    aims: 'Takes something off every hit you take.',
    notes: [
      'A flat subtraction, so it is worth the same against a nibble and against a slam - which means it is worth EVERYTHING against a swarm of small things and very little against one big one.',
      'It can never absorb a hit completely. Something always gets through.',
    ],
  },
  'p-repair': {
    aims: 'A clock that mends you, slowly, without being asked.',
    notes: [
      'Every few seconds it puts a little of the hull back. It is not much at once and it is not meant to be - what it changes is that being hurt is no longer permanent between barrels.',
      'Half the ladder makes each repair bigger and half makes it come round sooner, which are different things: more is worth having when a repair lands, sooner is worth having while you are still being chased.',
      'It only mends what is missing. At full hull the clock sits at the top of its dial, so the first repair after a hit is always a whole interval away rather than arriving because the timer happened to be due.',
    ],
  },
  'p-shield': {
    aims: 'A rim that eats one hit outright, whatever the size of it.',
    notes: [
      'The opposite shape to plating. Plating shaves a little off everything; a rim stops one hit dead - so it is worth almost nothing against a nibble and everything against the thing that would have killed you.',
      'Breaking one burns whatever broke it, and buys a moment where nothing can touch you at all. In a crowd that window absorbs the whole simultaneous pile-on rather than the single bite that broke the rim.',
      'They come back on their own, and a finished shield carries a second rim that recharges in its turn.',
    ],
  },
  'p-blast': {
    aims: 'Does nothing at all unless something you hold explodes.',
    notes: [
      'Every blast reaches wider — the artillery barrage, a drone going out, the burst on a phase bolt. Guns that do not explode never notice it, which is why the deck will not offer it until you hold something that does.',
      'Area grows faster than the ring: widening a circle by half more than doubles the ground it covers. The number on the floor is the radius; the value is the crowd inside it.',
    ],
  },
  'p-radiator': {
    aims: 'Does nothing at all unless you are holding a laser.',
    notes: [
      'A bigger heat buffer and faster shedding between bursts, on every beam you hold. It has no opinion on anything that is not a laser, which is why the deck will not offer it until you already have one.',
      'Half the ladder buys a longer burst before the cut-out, half buys a shorter wait once it does - which are different things: more buffer is worth having mid-burn, faster shedding is worth having while you wait for it to come back.',
      'It never touches how hard a beam hits, only how long it can keep hitting. Ordnance is the card for the first half of that trade; this is the card for the second.',
    ],
  },
  'p-ammo': {
    aims: 'Does nothing at all unless you are holding a magazine gun.',
    notes: [
      'Deeper drums on the belt guns - the Machine Gun and the Flak Cannon, the only two that ever run dry. Everything else in the loadout never notices it, which is why the deck will not offer it until you hold one.',
      'It never touches the reload itself - that is Feed Systems, and the two stack. This is purely how much fires before the belt runs out at all.',
      'Locked until proven. It stays out of the deck entirely until a save has spent a long time listening to its own guns click empty and reload.',
    ],
  },
};

/**
 * THE HORDE. What each variant is FOR, in the same voice as the weapon pages.
 *
 * Keyed by the catalog's own `name`, so a new flavour is a missing page rather than a wrong one.
 * The numbers behind these sentences live in content/enemyCatalog.ts and are deliberately not
 * repeated here - a variant is 18% faster or 30% tougher, and what a player needs is which way it
 * leans, not the multiplier.
 *
 * THE BODIES ON THESE PAGES ARE REPRESENTATIVE, not the variant's own: enemy art is per CYCLE, not
 * per flavour, so the same swift chassis wears a different sprite in wave 1 and wave 6. Each LEVEL
 * supplies its own representative (`LevelDef.bestiaryBody`) and the page shows one per level, so a
 * variant is illustrated by every map it can appear on and by no map it cannot. The CSS supplies
 * the flavour's own render cue - the heavy's cool tint, the spiky's red rim, the size difference
 * between a runt and a bruiser.
 */
interface EnemyEntry {
  readonly lead: string;
  readonly notes: readonly string[];
}

const ENEMY_MANUAL: Readonly<Record<string, EnemyEntry>> = {
  plain: {
    lead: 'The baseline. Everything else is described against this.',
    notes: [
      'No bonus and no weakness. Whatever the wave is made of, this is what it is made of most.',
      'It is the variant that teaches you the wave: how fast this one walks is how fast you have to walk.',
    ],
  },
  swift: {
    lead: 'Faster, and paid for in hit points and bite.',
    notes: [
      'The one variant that can close a gap you thought you had. It arrives ahead of its own wave and it arrives alone, which is what makes it dangerous - you turn to deal with it and the rest of the crowd is still coming.',
      'It dies quickly once you are looking at it. The whole threat is where it is, not what it does.',
    ],
  },
  tough: {
    lead: 'More hit points, less speed, and visibly bigger.',
    notes: [
      'Drawn larger than the rest, deliberately: the extra hit points are a fact you have to be able to read at a glance while running.',
      'It hits no harder than a plain. It just takes longer to stop, which means it is still there while everything behind it catches up.',
    ],
  },
  spiky: {
    lead: 'Hits much harder than anything else its size.',
    notes: [
      'The red rim is the only cue. Its hit points and its speed are ordinary, so nothing about how it moves warns you - and every weapon in the game targets by size or by hit points, so nothing you carry prioritises it either.',
      'This is the variant that kills a full-health mech by being ignored in a crowd.',
    ],
  },
  heavy: {
    lead: 'A wall that walks. Ten times the hit points at a twentieth of the speed.',
    notes: [
      'It never arrives with the ordinary horde - nothing in the drip can roll one. It comes as a RING ATTACK, a set-piece that drops a circle of them around you and closes it.',
      'And it barely moves when shot. A shell shoves it a quarter as far as it would shove anything else, so pushing your way out is not the escape it looks like.',
      'Both halves of the stat line matter. Ten times the hit points alone would be a roadblock you walk around; a twentieth of the speed alone would be a free kill. Together it is a thing you either grind down or go around, and it will still be there when you come back.',
    ],
  },
  swarmer: {
    lead: 'Twice the speed of anything else, and made of paper.',
    notes: [
      'Faster than every mech on the roster. Nothing here can outrun one.',
      'It arrives as THE SWARM - fifty of them set down off screen in one direction, running at a point near where you were standing rather than at you. So it comes through as a front with gaps in it, and pours past rather than converging.',
      'Then it turns around and loses half its speed doing it. A thing that fast could never be outrun once it actually started following you, so the trade is fixed: terrifying while it ignores you, ordinary once it does not.',
    ],
  },
  'chest dropper': {
    lead: 'Gold, and worth every second it takes. It leaves a Cyber Chest where it falls.',
    notes: [
      'It only ever arrives as a CHEST ELITE - one body, walking in on its own. Nothing in the drip can produce one, and it is the only enemy in the yard you should want to see.',
      'Three times the hit points of the elite it otherwise is, which on top of the rank is fifteen times a regular. That is the fight: it takes long enough that you have to commit to it while the wave keeps arriving.',
      'And it is slightly faster than an elite, which is the part that catches people out. Every other big thing in the yard trades speed away for bulk and can be left standing. This one follows.',
      'It pays half the usual XP. The chest is the payment.',
    ],
  },
};

/** One body per rank, drawn at the rank\'s own size. See EnemyEntry on why the frame is arbitrary. */
const RANK_MANUAL: Readonly<Record<string, EnemyEntry>> = {
  regular: {
    lead: 'The horde. What the drip is made of.',
    notes: ['One rank below elite in every respect, and the only rank that arrives continuously.'],
  },
  elite: {
    lead: 'Ten times the hit points, half again the damage, and slower.',
    notes: [
      'Drops in mid-wave rather than walking on with the crowd, and drawn half again as large.',
      'Worth eight times the experience of a regular, which is what makes going out of your way for one a real decision rather than an obvious no.',
    ],
  },
  boss: {
    lead: 'One per wave, and it cannot be pushed.',
    notes: [
      'Forty-two times a regular\'s hit points, more than twice the damage, and a blue outline so it is never lost in a crowd.',
      'Immovable - its mass is set so high that no weapon in the game moves it at all. Every other body in the yard can be kited by shoving it; this one cannot.',
      'Sixty times the experience, and it drops a Cyber Chest.',
    ],
  },
};

/** The four top-level sections, in the order they appear. */
type Section = 'systems' | 'mechs' | 'enemies' | 'achievements';

const SECTIONS: readonly { readonly id: Section; readonly label: string; readonly blurb: string }[] =
  [
    { id: 'systems', label: 'Systems', blurb: 'Guns and the systems that feed them' },
    { id: 'mechs', label: 'Mechs', blurb: 'Every chassis you have earned' },
    { id: 'enemies', label: 'Enemies', blurb: 'Everything you have put down' },
    { id: 'achievements', label: 'Achievements', blurb: 'What you have done' },
  ];

export class ScrapopediaScreen {
  readonly element: HTMLDivElement;

  private readonly sectionsEl: HTMLDivElement;
  private readonly indexEl: HTMLDivElement;
  private readonly detailEl: HTMLDivElement;
  private readonly backBtn: HTMLButtonElement;
  private readonly titleEl: HTMLHeadingElement;

  /**
   * WHICH OF THE THREE PANES IS SHOWING, and enough to rebuild it. The only state this screen has.
   *
   * `section` is null on the section menu. `open` is null on an index. A tagged pair rather than a
   * bare integer for `open`, because four catalogs have four index spaces and a lone number would
   * silently open the wrong page the day any of them is reordered.
   */
  private section: Section | null = null;
  private open: {
    readonly kind: 'upgrade' | 'ascension' | 'mech' | 'enemy' | 'rank' | 'creature';
    readonly index: number;
  } | null = null;

  /**
   * `has` answers "does this player have it" for each catalog that can be unlocked. Predicates
   * rather than the AppState itself, so this screen depends on the question it is asking rather
   * than on where the save file lives.
   */
  constructor(
    private readonly onExit: () => void,
    private readonly has: {
      upgrade: (id: UpgradeId) => boolean;
      /** By the PARENT weapon's id - an ascension has no id of its own. See Settings. */
      ascension: (id: UpgradeId) => boolean;
      hero: (id: HeroId) => boolean;
      achievement: (id: AchievementId) => boolean;
      /**
       * Career progress toward a locked achievement, 0..1, or -1 for the ones that have no
       * meaningful bar - see `unlockProgress` in core/data/unlocks.ts. Same predicate shape as
       * the rest: this screen asks the question, the save answers it.
       */
      progress: (id: AchievementId) => number;
      killed: (name: string) => boolean;
    },
  ) {
    const el = document.createElement('div');
    el.className = 'overlay pedia';
    el.hidden = true;
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Scrapopedia');

    const head = document.createElement('div');
    head.className = 'pedia__head';
    head.innerHTML = `<div class="eyebrow">Field manual</div>
      <h1 class="pedia__title">Scrapopedia</h1>`;
    el.appendChild(head);
    this.titleEl = head.querySelector('.pedia__title') as HTMLHeadingElement;

    this.sectionsEl = document.createElement('div');
    this.sectionsEl.className = 'pedia__sections';
    for (const sec of SECTIONS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'pedia__section-btn';
      const name = document.createElement('span');
      name.className = 'pedia__section-name';
      name.textContent = sec.label;
      const blurb = document.createElement('span');
      blurb.className = 'pedia__section-blurb';
      blurb.textContent = sec.blurb;
      b.append(name, blurb);
      b.addEventListener('click', () => this.showSection(sec.id));
      this.sectionsEl.appendChild(b);
    }
    el.appendChild(this.sectionsEl);

    this.indexEl = document.createElement('div');
    this.indexEl.className = 'pedia__index';
    el.appendChild(this.indexEl);

    this.detailEl = document.createElement('div');
    this.detailEl.className = 'pedia__detail';
    this.detailEl.hidden = true;
    el.appendChild(this.detailEl);

    this.backBtn = document.createElement('button');
    this.backBtn.type = 'button';
    this.backBtn.className = 'btn btn--primary pedia__back';
    this.backBtn.textContent = 'Back';
    // ONE BACK BUTTON FOR THREE PANES, AND IT ALWAYS SAYS BACK. It walks exactly one step: page ->
    // index -> sections -> out. It used to relabel itself "All entries" on a page, which was a
    // second word for the only thing the button has ever done and made the control read as a
    // different control depending on where you were standing.
    this.backBtn.addEventListener('click', () => {
      if (this.open !== null) this.showIndex();
      else if (this.section !== null) this.showSections();
      else this.onExit();
    });
    el.appendChild(this.backBtn);

    this.element = el;
  }

  show(): void {
    this.showSections();
    this.element.hidden = false;
  }

  hide(): void {
    this.element.hidden = true;
  }

  /**
   * Rebuilt on every visit - see the header. A section is a heading, a tally and a grid, repeated
   * for however many groups that section has.
   *
   * THE TALLY NAMES THE TOTAL, which is the one number this screen prints. It has to: a manual
   * showing two entries and no denominator reads as a manual with two things in it, and the whole
   * point of a collection is knowing there is more of it. What is missing stays missing - no dimmed
   * row hints at its shape - so the total says how many without saying which.
   *
   * ACHIEVEMENTS ARE THE EXCEPTION: an unearned one IS listed, greyed, with its description
   * withheld. That is the deliberate difference between the two kinds of thing. A system you have
   * not held is a gap in a reference book and there is nothing to say about it; an achievement you
   * have not earned is a thing to go and do, and a list that hid them would be a list of things you
   * have already finished.
   */
  private buildIndex(section: Section): void {
    this.indexEl.innerHTML = '';

    if (section === 'systems') {
      for (const kind of ['weapon', 'passive'] as const) {
        const entries: HTMLButtonElement[] = [];
        let total = 0;
        for (let i = 0; i < UPGRADE_CATALOG.length; i++) {
          const def = UPGRADE_CATALOG[i];
          if (def.kind !== kind) continue;
          total++;
          if (this.has.upgrade(def.id)) entries.push(this.entryButton(def, i));
        }
        this.indexEl.appendChild(
          group(kind === 'weapon' ? 'Weapons' : 'Systems', entries.length, total),
        );
        this.indexEl.appendChild(grid(entries));
      }

      // ---- ascensions, and only once one has been held ---------------------------------------
      // Built AFTER both pools rather than inside the weapon loop, so an ascension never counts
      // toward the Weapons total. That total is read by a player who has found nothing, and a
      // count that moves when a secret is added is the secret being announced.
      const ascended: HTMLButtonElement[] = [];
      let ascensionsTotal = 0;
      for (let i = 0; i < UPGRADE_CATALOG.length; i++) {
        const def = UPGRADE_CATALOG[i];
        if (def.ascension === undefined) continue;
        ascensionsTotal++;
        if (this.has.ascension(def.id)) ascended.push(this.ascensionButton(def, i));
      }
      // The heading itself is the leak, not the entries under it - see this file's header.
      if (ascended.length > 0) {
        this.indexEl.appendChild(group('Ascensions', ascended.length, ascensionsTotal));
        this.indexEl.appendChild(grid(ascended));
      }
      return;
    }

    if (section === 'mechs') {
      const mechs: HTMLButtonElement[] = [];
      for (let i = 0; i < HERO_CATALOG.length; i++) {
        const hero = HERO_CATALOG[i];
        if (this.has.hero(hero.id)) mechs.push(this.mechButton(hero, i));
      }
      this.indexEl.appendChild(group('Chassis', mechs.length, HERO_CATALOG.length));
      this.indexEl.appendChild(grid(mechs));
      return;
    }

    if (section === 'enemies') {
      // THE CREATURES FIRST, one group per level, in ladder order then rank order - which is the
      // order they are met in. A level's own entries and nothing else: `bestiaryFor` reads that
      // level's ladder and that level's creature table, so no map can list another's animals.
      for (const level of LEVEL_CATALOG) {
        if (!level.playable) continue;
        const all = bestiaryFor(level);
        const known = all.filter((e) => this.has.killed(e.key));
        this.indexEl.appendChild(group(level.name, known.length, all.length));
        this.indexEl.appendChild(grid(known.map((e) => this.creatureButton(e))));
      }

      // GATED ON HAVING KILLED ONE, which is the bestiary's version of the rule the rest of this
      // screen follows: a page is written the first time you have actually had the thing in your
      // hands, or in this case put it down. Not on having SEEN one - something that walks past
      // while you run has taught you nothing, and a kill is the one threshold the simulation
      // already counts exactly.
      const variants: HTMLButtonElement[] = [];
      for (let i = 0; i < FLAVOURS.length; i++) {
        if (this.has.killed(FLAVOURS[i].name)) variants.push(this.enemyButton(FLAVOURS[i], i));
      }
      this.indexEl.appendChild(group('Variants', variants.length, FLAVOURS.length));
      this.indexEl.appendChild(grid(variants));

      const ranks: HTMLButtonElement[] = [];
      for (let i = 0; i < RANKS.length; i++) {
        if (this.has.killed(RANKS[i].name)) ranks.push(this.rankButton(RANKS[i], i));
      }
      this.indexEl.appendChild(group('Ranks', ranks.length, RANKS.length));
      this.indexEl.appendChild(grid(ranks));
      return;
    }

    const earned = ACHIEVEMENT_CATALOG.filter((a) => this.has.achievement(a.id)).length;
    this.indexEl.appendChild(group('Earned', earned, ACHIEVEMENT_CATALOG.length));
    this.indexEl.appendChild(
      grid(ACHIEVEMENT_CATALOG.map((a) => this.achievementRow(a))),
    );
  }

  /**
   * An achievement, earned or not. NOT a link - there is no page behind it, because everything
   * there is to say fits on the row.
   *
   * Unearned: greyed, and the description withheld. The name still shows, so the list is a set of
   * things to go and do rather than a row of locked boxes.
   *
   * ---------------------------------------------------------------------------------------------
   * THE ICON IS EARNED TOO
   * ---------------------------------------------------------------------------------------------
   * An earned row draws the achievement's own picture; an unearned one draws a sealed plate.
   *
   * IT IS NOT SYMMETRY WITH THE NAME, and the difference is the whole reason this is written down.
   * A name is a label - `Hornet's Nest` tells you there is something called that and nothing about
   * what it is. AN ICON IS THE ANSWER, and every kind in the catalog leaks differently:
   *
   *   A MECH trophy's icon is the CHASSIS SPRITE, which is exactly what the picker withholds
   *   behind a silhouette. Printing it here hands back the thing that screen is keeping.
   *   AN ASCENSION's icon is a picture of the mechanic - a missile coming apart. The Scrapopedia
   *   goes to some length elsewhere never to mention that a tier 8 exists (see this file's header);
   *   drawing one on a row nobody has earned would undo that in a single glance.
   *   A MAP's icon is one of that map's own CREATURES, and the bestiary gates those behind having
   *   killed one. This row is not the place they arrive early.
   *
   * The plate is therefore drawn for every unearned row regardless of `AchievementDef.secret`, which
   * is about the NAME and not about the picture: the map trophy is the one entry that is not secret,
   * because the yard picker has always named the yard.
   *
   * So the plate is the same promise the hero picker makes: there is something here, and finding
   * out what is the game.
   */
  private achievementRow(def: AchievementDef): HTMLButtonElement {
    const got = this.has.achievement(def.id);
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `pedia__entry pedia__entry--achv${got ? '' : ' pedia__entry--unearned'}`;
    b.disabled = true;

    if (got) {
      const icon = document.createElement('img');
      icon.className = 'pedia__icon pedia__icon--achv';
      icon.src = spriteUrl(def.icon);
      icon.alt = '';
      icon.decoding = 'async';
      b.appendChild(icon);
    } else {
      const sealed = document.createElement('span');
      sealed.className = 'pedia__icon pedia__icon--achv pedia__icon--sealed';
      sealed.textContent = '?';
      // Decoration: the row already reads as unearned through the withheld description, and a
      // screen reader announcing "question mark" before every locked name is noise.
      sealed.setAttribute('aria-hidden', 'true');
      b.appendChild(sealed);
    }

    const words = document.createElement('span');
    words.className = 'pedia__achv-words';

    const name = document.createElement('span');
    name.className = 'pedia__name';
    name.textContent = def.name;
    words.appendChild(name);

    if (got) {
      const desc = document.createElement('span');
      desc.className = 'pedia__achv-desc';
      desc.textContent = def.description;
      words.appendChild(desc);
    } else {
      // THE UNLABELED BAR, for the locked rows whose condition counts something across the whole
      // save. It says nothing about WHAT it measures - no caption, no numbers, no tooltip - and
      // that is the design, not an omission: the criteria are published nowhere (see the file
      // header on tier 8, and describeUnlockDone's whole reason for having no imperative form).
      // All this leaks is that something is counting, and that it moved since the player last
      // looked. That is the sealed plate's promise with a pulse in it, and watching the pulse
      // answer to what you did last run IS the discovery mechanism.
      const p = this.has.progress(def.id);
      if (p >= 0) {
        const bar = document.createElement('span');
        bar.className = 'pedia__achv-bar';
        // Decoration to a screen reader for the same reason it is unlabeled to everyone else:
        // announcing a bare percentage of an unnamed thing is noise, not information.
        bar.setAttribute('aria-hidden', 'true');
        const fill = document.createElement('span');
        fill.className = 'pedia__achv-bar-fill';
        fill.style.width = `${Math.round(p * 100)}%`;
        bar.appendChild(fill);
        words.appendChild(bar);
      }
    }

    b.appendChild(words);
    return b;
  }

  /**
   * ONE CREATURE, AT ONE RANK. Unlike the variant and rank rows this shows exactly ONE body - its
   * own - because the page is about that creature rather than about a property several share.
   */
  private creatureButton(e: BestiaryEntry): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'pedia__entry pedia__entry--enemy';

    const icon = creatureIcon(e, 'pedia__icon pedia__icon--enemy', false);
    const name = document.createElement('span');
    name.className = 'pedia__name';
    name.textContent = e.name;

    b.append(icon, name);
    b.addEventListener('click', () => this.showCreature(e));
    return b;
  }

  private enemyButton(f: FlavourDef, index: number): HTMLButtonElement {
    return this.bodyButton(titleCase(f.name), flavourCue(f), () => this.showEnemy(index));
  }

  private rankButton(r: RankDef, index: number): HTMLButtonElement {
    return this.bodyButton(titleCase(r.name), rankCue(r), () => this.showRank(index));
  }

  /**
   * A horde entry. One body per level (see `bodyRow`) and the CUES are the real ones: the size
   * difference, the heavy\'s cool tint, the spiky\'s red rim. Those are what a player actually
   * recognises a variant by, so the row teaches the same thing the battlefield does - on both maps
   * at once, which is the only honest way to show a property both maps share.
   */
  private bodyButton(label: string, cue: BodyCue, onTap: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'pedia__entry pedia__entry--enemy';

    const icon = bodyRow(cue, 'pedia__icon pedia__icon--enemy');

    const name = document.createElement('span');
    name.className = 'pedia__name';
    name.textContent = label;

    b.append(icon, name);
    b.addEventListener('click', onTap);
    return b;
  }

  private mechButton(hero: HeroDef, index: number): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'pedia__entry pedia__entry--mech';

    const icon = document.createElement('img');
    icon.className = 'pedia__icon pedia__icon--mech';
    icon.src = spriteUrl(hero.sprite);
    icon.alt = '';
    icon.decoding = 'async';

    const name = document.createElement('span');
    name.className = 'pedia__name';
    name.textContent = hero.name;

    b.append(icon, name);
    b.addEventListener('click', () => this.showMech(index));
    return b;
  }

  private entryButton(def: UpgradeDef, index: number): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `pedia__entry pedia__entry--${def.kind}`;

    const icon = document.createElement('img');
    icon.className = 'pedia__icon';
    icon.src = spriteUrl(`icon_${def.id}`);
    icon.alt = '';
    icon.decoding = 'async';

    const name = document.createElement('span');
    name.className = 'pedia__name';
    name.textContent = def.name;

    b.append(icon, name);
    b.addEventListener('click', () => this.showDetail(index));
    return b;
  }

  /**
   * The row for a weapon's tier 8. `index` is the PARENT weapon's catalog index, which is the only
   * handle an ascension has - it is a field on a card, not a card.
   *
   * Its own name and its own icon, both read from the ascension rather than from the weapon, so
   * the row shows what the thing is called now and not what it used to be.
   */
  private ascensionButton(def: UpgradeDef, index: number): HTMLButtonElement {
    const asc = def.ascension;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'pedia__entry pedia__entry--ascension';

    const icon = document.createElement('img');
    icon.className = 'pedia__icon';
    icon.src = spriteUrl(`icon_${asc?.icon ?? def.id}`);
    icon.alt = '';
    icon.decoding = 'async';

    const name = document.createElement('span');
    name.className = 'pedia__name';
    name.textContent = asc?.name ?? def.name;

    b.append(icon, name);
    b.addEventListener('click', () => this.showAscension(index));
    return b;
  }

  private showSections(): void {
    this.section = null;
    this.closePage();
    this.titleEl.textContent = 'Scrapopedia';
    this.sectionsEl.hidden = false;
    this.indexEl.hidden = true;
    this.element.scrollTop = 0;
  }

  private showSection(section: Section): void {
    this.section = section;
    this.buildIndex(section);
    this.showIndex();
  }

  /** Back to the current section's list. Never rebuilt here - `showSection` owns that. */
  private showIndex(): void {
    this.closePage();
    this.titleEl.textContent = SECTIONS.find((s) => s.id === this.section)?.label ?? 'Scrapopedia';
    this.sectionsEl.hidden = true;
    this.indexEl.hidden = false;
    this.element.scrollTop = 0;
  }

  /**
   * Puts the open entry away: hidden AND emptied.
   *
   * EMPTIED, not merely hidden. Hiding it was already meant to be enough and was not - a `display`
   * on the pane's own class outranks the `hidden` attribute, so the page the player had just left
   * went on rendering below the list they had gone back to. That is fixed in the stylesheet, but a
   * pane holding a page nobody asked for is a pane that can be revealed again by the next styling
   * change, and there is nothing worth keeping in it: every page is rebuilt from the catalog when
   * it is opened.
   */
  private closePage(): void {
    this.open = null;
    this.detailEl.hidden = true;
    this.detailEl.innerHTML = '';
  }

  /** Common to every kind of page: clear the old one, show the pane, start at the top. */
  private openPage(
    kind: 'upgrade' | 'ascension' | 'mech' | 'enemy' | 'rank' | 'creature',
    index: number,
  ): void {
    this.open = { kind, index };
    this.sectionsEl.hidden = true;
    this.indexEl.hidden = true;
    this.detailEl.hidden = false;
    this.detailEl.innerHTML = '';
    this.element.scrollTop = 0;
  }

  private showEnemy(index: number): void {
    const f = FLAVOURS[index];
    if (f === undefined) return;
    this.openPage('enemy', index);
    const entry = ENEMY_MANUAL[f.name];
    this.detailEl.appendChild(bodyHead(titleCase(f.name), 'Variant', flavourCue(f)));
    if (entry === undefined) return;
    this.detailEl.appendChild(para('pedia__desc', entry.lead));
    this.detailEl.appendChild(section('In the yard'));
    for (const n of entry.notes) this.detailEl.appendChild(para('pedia__note', n));
  }

  /**
   * A creature's page: its own body at its own rank, the rung's character, and what the rank means.
   *
   * The rank paragraph is RANK_MANUAL's, not a second copy - a boss means the same thing on both
   * maps and on all sixteen rungs, and writing it out per creature is how forty-eight pages start
   * disagreeing with each other.
   */
  private showCreature(e: BestiaryEntry): void {
    this.openPage('creature', e.rung * RANKS.length + e.rank);
    this.detailEl.appendChild(creatureHead(e));

    const own = CYCLE_MANUAL[`${e.levelId}/${e.cycleName}`];
    if (own !== undefined) {
      this.detailEl.appendChild(para('pedia__desc', own.lead));
      this.detailEl.appendChild(section(e.levelName));
      for (const n of own.notes) this.detailEl.appendChild(para('pedia__note', n));
    }

    const rank = RANK_MANUAL[RANKS[e.rank].name];
    if (rank !== undefined && e.rank !== 0) {
      this.detailEl.appendChild(section(`As ${titleCase(RANKS[e.rank].name)}`));
      this.detailEl.appendChild(para('pedia__note', rank.lead));
    }
  }

  private showRank(index: number): void {
    const r = RANKS[index];
    if (r === undefined) return;
    this.openPage('rank', index);
    const entry = RANK_MANUAL[r.name];
    this.detailEl.appendChild(bodyHead(titleCase(r.name), 'Rank', rankCue(r)));
    if (entry === undefined) return;
    this.detailEl.appendChild(para('pedia__desc', entry.lead));
    this.detailEl.appendChild(section('In the yard'));
    for (const n of entry.notes) this.detailEl.appendChild(para('pedia__note', n));
  }

  private showMech(index: number): void {
    const hero = HERO_CATALOG[index];
    if (hero === undefined) return;
    this.openPage('mech', index);

    const head = document.createElement('div');
    head.className = 'pedia__page-head';
    const icon = document.createElement('img');
    icon.className = 'pedia__page-icon pedia__page-icon--mech';
    icon.src = spriteUrl(hero.sprite);
    icon.alt = '';
    const title = document.createElement('div');
    title.className = 'pedia__page-name';
    title.textContent = hero.name;
    const kind = document.createElement('div');
    kind.className = 'pedia__page-kind pedia__page-kind--mech';
    kind.textContent = 'Mech';
    const words = document.createElement('div');
    words.append(title, kind);
    head.append(icon, words);
    this.detailEl.appendChild(head);

    // The picker's own line. See the header for why this is not written twice.
    this.detailEl.appendChild(para('pedia__desc', hero.identity));

    this.detailEl.appendChild(section('Walks in holding'));
    const gun = hero.startingWeapon;
    this.detailEl.appendChild(
      para(
        'pedia__aims',
        gun === null ? 'Nothing at all.' : weaponNameAtTier(gun, 1) || gun,
      ),
    );
    if (gun === null) {
      this.detailEl.appendChild(
        para(
          'pedia__note',
          'The only chassis that starts unarmed. Everything it kills in the first minute, it kills by being hit - and the first card it is offered is a gun.',
        ),
      );
    }

    const seeded = hero.startingUpgrade;
    if (seeded !== undefined) {
      const def = UPGRADE_CATALOG.find((d) => d.id === seeded);
      if (def !== undefined) {
        this.detailEl.appendChild(section('And already fitted'));
        this.detailEl.appendChild(para('pedia__aims', def.name));
        this.detailEl.appendChild(para('pedia__note', def.description));
      }
    }

    this.detailEl.appendChild(section('Frame'));
    this.detailEl.appendChild(
      para(
        'pedia__note',
        hero.gait === 'hover'
          ? 'A hover frame. It drifts rather than steps, and it is never quite still.'
          : 'A walking frame. The legs carry the stride, so it only animates when it is going somewhere.',
      ),
    );
  }

  private showDetail(index: number): void {
    const def = UPGRADE_CATALOG[index];
    if (def === undefined) return;
    this.openPage('upgrade', index);
    const manual = MANUAL[def.id];

    const head = document.createElement('div');
    head.className = 'pedia__page-head';
    const icon = document.createElement('img');
    icon.className = 'pedia__page-icon';
    icon.src = spriteUrl(`icon_${def.id}`);
    icon.alt = '';
    const title = document.createElement('div');
    title.className = 'pedia__page-name';
    title.textContent = def.name;
    const kind = document.createElement('div');
    kind.className = `pedia__page-kind pedia__page-kind--${def.kind}`;
    kind.textContent = def.kind === 'weapon' ? 'Weapon' : 'System';
    const words = document.createElement('div');
    words.append(title, kind);
    head.append(icon, words);
    this.detailEl.appendChild(head);

    // The card's own words, so the two can never say different things.
    this.detailEl.appendChild(para('pedia__desc', def.description));

    if (manual !== undefined) {
      this.detailEl.appendChild(section('Targeting'));
      this.detailEl.appendChild(para('pedia__aims', manual.aims));
      for (const n of manual.notes) this.detailEl.appendChild(para('pedia__note', n));
    }

    // THE LADDER, READ FROM THE CATALOG. Tier 1 is the unlock and says nothing worth a row, so the
    // list starts at the first rung that changes something.
    this.detailEl.appendChild(section('As it levels'));
    const list = document.createElement('ol');
    list.className = 'pedia__tiers';
    for (let t = 1; t < def.tiers.length; t++) {
      const li = document.createElement('li');
      li.textContent = def.tiers[t];
      list.appendChild(li);
    }
    this.detailEl.appendChild(list);
  }

  /**
   * A weapon's tier 8, as its own page. `index` is the parent weapon's catalog index.
   *
   * NO LADDER SECTION, because there is no ladder: an ascension is one rung and the last one. The
   * page says what it is, what it came from, and what it cost - and it can say the last of those
   * plainly, in the past tense, because it is only ever read by someone who has already paid it.
   * That is the same rule the achievement banners follow and the reason there is deliberately no
   * imperative version of any of this text.
   *
   * It states ITS OWN recipe and no other. A page that said "every weapon has one of these" would
   * hand over eight secrets for the price of one.
   */
  private showAscension(index: number): void {
    const def = UPGRADE_CATALOG[index];
    const asc = def?.ascension;
    if (def === undefined || asc === undefined) return;
    this.openPage('ascension', index);

    const head = document.createElement('div');
    head.className = 'pedia__page-head';
    const icon = document.createElement('img');
    icon.className = 'pedia__page-icon';
    icon.src = spriteUrl(`icon_${asc.icon}`);
    icon.alt = '';
    const title = document.createElement('div');
    title.className = 'pedia__page-name';
    title.textContent = asc.name;
    const kind = document.createElement('div');
    kind.className = 'pedia__page-kind pedia__page-kind--ascension';
    kind.textContent = 'Ascension';
    const words = document.createElement('div');
    words.append(title, kind);
    head.append(icon, words);
    this.detailEl.appendChild(head);

    // The ascension's own words, read from the catalog exactly as every other page reads the
    // card's - so the chest that grants it and the manual that records it cannot drift apart.
    this.detailEl.appendChild(para('pedia__desc', asc.description));

    this.detailEl.appendChild(section('What it was'));
    this.detailEl.appendChild(
      para('pedia__note', `${def.name}, finished. This is what it became, and it does not go back.`),
    );

    // The recipe, resolved from the catalog rather than written out, so a change to `requires`
    // cannot leave this sentence describing the old one.
    const gate = UPGRADE_CATALOG.find((d) => d.id === asc.requires);
    this.detailEl.appendChild(section('How it was earned'));
    this.detailEl.appendChild(
      para(
        'pedia__note',
        `Carried to its last tier alongside ${gate?.name ?? asc.requires}, and opened out of a Cyber Chest.`,
      ),
    );
  }
}

function para(cls: string, text: string): HTMLParagraphElement {
  const p = document.createElement('p');
  p.className = cls;
  p.textContent = text;
  return p;
}

/** A group heading with its "3 of 8 recorded" tally. */
function group(text: string, found: number, total: number): HTMLDivElement {
  const d = document.createElement('div');
  d.className = 'pedia__group';
  const name = document.createElement('span');
  name.textContent = text;
  const tally = document.createElement('span');
  tally.className = 'pedia__tally';
  tally.textContent = `${found} of ${total}`;
  d.append(name, tally);
  return d;
}

/**
 * THE CREATURES, one page per rung of each level's ladder, keyed `<levelId>/<cycleName>`.
 *
 * ONE ENTRY PER RUNG RATHER THAN PER RANK. A rung's three ranks are the same animal getting worse -
 * on the Scrapyard literally, three paints of one hull; on Mossy a blowfly that becomes a killer
 * bee that becomes a mosquito. So the creature's own character is written once here and the RANK
 * supplies what a rank means (RANK_MANUAL), which is how the two never end up disagreeing.
 *
 * NO MAGNITUDES, exactly as on the cards: which way the thing leans, not by how much. A player
 * reading this has met the creature; what they want is the sentence that makes the next encounter
 * legible, not a number they would have to hold against another number.
 *
 * Keyed by level id AND name so the two maps cannot collide, and so a missing page is a blank
 * rather than another creature's description.
 */
const CYCLE_MANUAL: Readonly<Record<string, EnemyEntry>> = {
  'scrapyard/Rustling': {
    lead: 'The first thing that ever came for you, and the slowest.',
    notes: [
      'It arrives alone, in ones and twos, and it dies to whatever you are holding. That is the point: the opening minutes are where you find out what your guns do without anything punishing you for looking.',
      'Nothing else in the yard is this forgiving. If a Rustling reaches you, you were standing still.',
    ],
  },
  'scrapyard/Scavenger': {
    lead: 'Quicker than a Rustling and no tougher at all.',
    notes: [
      'The wave that teaches you distance is not safety. It closes gaps you had already decided were enough, and it does it while you are looking at something else.',
      'It still dies immediately. The whole threat is where it is, not what it does when it gets there.',
    ],
  },
  'scrapyard/Hauler': {
    lead: 'Slow and fat. You can walk away from these; you cannot ignore them.',
    notes: [
      'The first body that outlives your attention. It takes long enough to bring down that the wave behind it arrives while you are still working, which is a different problem from anything before it.',
      'Nothing about it is fast. Everything about it is in the way.',
    ],
  },
  'scrapyard/Prowler': {
    lead: 'The fastest thing in the yard, and lighter than what came before it.',
    notes: [
      'The one rung where the horde gets FLIMSIER than the last. It is a change of question rather than an increase: the Hauler asked how long you could keep firing, this asks whether you can be somewhere else.',
      'It will catch you if you commit to a fight facing the wrong way.',
    ],
  },
  'scrapyard/Hardhead': {
    lead: 'Slams the brakes, and nearly doubles the bite.',
    notes: [
      'The first cycle that genuinely hurts to touch. Everything before it could be walked through in an emergency; this is where that stops being free.',
      'Wide, and it does not move when you shoot it. Slow enough that none of that has to happen to you - being hit by one is a decision you made a second earlier.',
    ],
  },
  'scrapyard/Breaker': {
    lead: 'Quick again, and it hits harder than anything so far.',
    notes: [
      'The Hardhead was slow enough to forgive a mistake. This is not, and it arrives with the pace of the Prowler and the weight of the Hardhead at the same time.',
      'The rung where standing your ground stops being a style and starts being a way to die.',
    ],
  },
  'scrapyard/Warden': {
    lead: 'Tanky and unhurried.',
    notes: [
      'It does not chase and it does not need to. By this point in a run the field never empties, so a body that simply refuses to fall is doing the work of three that would have.',
      'Bites less than the Breaker did. It is a wall being built around you rather than a thing attacking you.',
    ],
  },
  'scrapyard/Dozer': {
    lead: 'The slowest thing in the yard, and the hardest to finish.',
    notes: [
      'The endgame is NUMBERS, not pace. It closes in slowly and the problem is that there is no gap in it.',
      'Lighter than it looks for something that takes this long to kill - it can be shoved, and late on that is the difference between a corner you chose and one you were pushed into.',
    ],
  },

  'mossy-mayhem/Sporeling': {
    lead: 'Slow, soft, and there are a great many of them.',
    notes: [
      'Moss opens the way the yard does - with something that cannot hurt you while you work out what your guns do on new ground.',
      'The same creature stands in for all three ranks here. What changes is how big it is and how long it takes.',
    ],
  },
  'mossy-mayhem/Swarm': {
    lead: 'Fast and flimsy. Distance is not safety out here either.',
    notes: [
      'It escalates by getting more weapon rather than more body: a blowfly, then a killer bee, then a mosquito the size of the bee. You can read which one is coming before it arrives.',
      'None of the three survives being looked at. All of them are somewhere you did not expect.',
    ],
  },
  'mossy-mayhem/Formless': {
    lead: 'Slow and fat. Walk away from these; do not ignore them.',
    notes: [
      'A jelly, then an ooze, then something with a shell on.',
      'HURT THE BIG ONE ENOUGH AND ITS SHELL COMES OFF. What is left is faster to look at and no easier to finish - the shell was never the fight, it was the half of the fight you had done.',
    ],
  },
  'mossy-mayhem/Pack': {
    lead: 'The fastest thing on the moss, and lighter than the Formless before it.',
    notes: [
      'A jackal, then something with lightning in it, then something on fire. Three dogs, and the escalation is what they are made of rather than how big they are.',
      'The rung that punishes committing to a direction.',
    ],
  },
  'mossy-mayhem/Vine Stalker': {
    lead: 'Slams the brakes, and nearly doubles the bite.',
    notes: [
      'The first thing on this map that hurts to touch. It does not chase well and it does not have to.',
      'Rooted-looking and absolutely not rooted. That is the joke and it costs you the first time.',
    ],
  },
  'mossy-mayhem/Draconian': {
    lead: 'Quick again, and it hits hardest of anything so far.',
    notes: [
      'Pace and weight arriving together, which is the combination the Vine Stalker let you off.',
      'The rung where the moss stops being the easier map.',
    ],
  },
  'mossy-mayhem/Golem': {
    lead: 'Tanky and unhurried - dirt, then rock, then metal.',
    notes: [
      'The three ranks are three materials, and you can tell at a glance which one you have walked into.',
      'It bites less than the Draconian did. It simply does not fall over, and by now the field never empties.',
    ],
  },
  'mossy-mayhem/Wyrm': {
    lead: 'A wall. The slowest thing on the map and by far the heaviest.',
    notes: [
      'A dragon, then a golden one, then something with rather more heads than that.',
      'THE BIG ONE LOSES A HEAD EVERY TIME YOU TAKE A FIFTH OF IT DOWN. It is the only health bar in the game you can read from across the field without looking at the bar.',
    ],
  },

  'city-chaos/Junkbots': {
    lead: 'The first machine this street sends, and there is only ever one of it at a time.',
    notes: [
      'It wanders more than it hunts, and for the first two minutes on this map that is the whole horde - the same courtesy the Scrapyard opened with, so what you learn first here is the grid, not your own guns again.',
      'ITS BOSS DOES NOT STAY DOWN. Beat it here, alone, and it is back next cycle walking in pairs beside something new - the promotion is what this map is built around, and it starts on the very first rung.',
    ],
  },
  'city-chaos/Sentries': {
    lead: 'Unarmed, and faster for it. A security bot that runs rather than fights.',
    notes: [
      'It carries nothing that can hurt you, so the only cost it charges is your attention - every one that slips past is one you chose not to shoot rather than one that beat you.',
      'The elite here is a face already put down once: the boss from last cycle, walking again at the same size it fell at.',
    ],
  },
  'city-chaos/Drones': {
    lead: 'The fastest thing this street fields, and it comes from above.',
    notes: [
      'Nothing on the ground outruns one. What saves you is that it is as fragile as everything else this early - the danger is entirely in how many of them are suddenly in the air at once.',
      'The boss from last cycle is promoted into the elite slot again here, still built the same size it went down at.',
    ],
  },
  'city-chaos/Rovers': {
    lead: 'Six wheels, no hurry, and no reason to be anywhere but where you already are.',
    notes: [
      'The first body on this map that outlasts your attention. It is not fast enough to catch you and does not need to be - the wave behind it is what you are actually racing.',
      'The body class steps up here, so the elite beside it is not the old boss shrunk down to fit - it is the same machine, built up to full weight for the rung it now stands on.',
    ],
  },
  'city-chaos/Gun Sentries': {
    lead: 'The sentry from three streets back, and now it is armed.',
    notes: [
      'Slams the brakes and very nearly doubles the bite - the first machine on this map you cannot walk through by accident and shrug off.',
      'It does not chase well. Being hit by one this early is a decision made a second before it happened, not something done to you.',
    ],
  },
  'city-chaos/Gun Drones': {
    lead: 'The drone from two cycles back, armed and quick again.',
    notes: [
      'Pace and payload arrive together this time, which is the combination the Gun Sentries let you off - it hits harder than anything so far and is fast enough to reach you doing it.',
      'The rung where standing under an empty sky stops being safe by default.',
    ],
  },
  'city-chaos/Fighters': {
    lead: 'Strafing aircraft, and unhurried about it.',
    notes: [
      'It does not need to close in - it already owns the air above you, and by this point in a run the sky is never empty either.',
      'Bites less than the Gun Drones did. It wears you down over a pass rather than threatening you with one.',
    ],
  },
  'city-chaos/Armour': {
    lead: 'A wall of dozer-yellow tanks, and the slowest thing this street fields.',
    notes: [
      'The endgame here is the same as everywhere else: numbers, not pace. It closes in slowly and there is no gap anywhere in the column behind it.',
      'The last promotion on the ladder: the boss from two cycles back is built up to full weight now, standing beside armour that never learned to hurry.',
    ],
  },
};

/**
 * ONE CREATURE'S OWN BODY, at its own rank, corrected for content size.
 *
 * `rankCue` supplies the size step, so a boss entry is drawn visibly larger than its regular - the
 * same relationship the field shows, which is what makes a 24-row index readable at a glance.
 */
/**
 * The widest body any level fields, so a bestiary row can be drawn at its TRUE relative size
 * without the biggest one deciding the row height by itself. Derived, not typed: a level with a
 * larger creature must not silently overflow the list.
 */
const WIDEST_BODY: number = Math.max(
  ...LEVEL_CATALOG.flatMap((l) => l.creatures.map((c) => c.drawSize)),
);

/**
 * A creature row's cue: SIZE ONLY, and the size is the real one.
 *
 * TWO THINGS ARE DELIBERATELY DIFFERENT FROM `rankCue`, which the Ranks pages use.
 *
 * The BODY SIZE is in it. `bestiaryIconScale` normalises every sprite so its content fills its
 * box, which is right when the point is to compare two maps' bodies of the SAME class - and wrong
 * here, where it made a Breaker look no bigger than a Rustling. Multiplying back by the
 * creature's own `drawSize` restores the fact the index is supposed to teach.
 *
 * The BOSS GLOW is not. A drop-shadow on a transform-scaled sprite bleeds well outside its row,
 * and twenty-four rows of it smeared into one continuous band down the boss column. The row
 * already says "boss" in words and draws it largest; the glow is kept for the page header, where
 * there is exactly one of them and the space to show it.
 */
function creatureCue(e: BestiaryEntry, glow: boolean): BodyCue {
  const rank = rankCue(RANKS[e.rank]);
  return {
    scale: rank.scale * (e.creature.drawSize / WIDEST_BODY),
    filter: glow ? rank.filter : '',
  };
}

function creatureIcon(e: BestiaryEntry, cls: string, glow: boolean): HTMLImageElement {
  const icon = document.createElement('img');
  icon.className = cls;
  // `frames[0]`: the healthy face. A creature that comes apart is meant to be discovered doing it.
  icon.src = spriteUrl(e.creature.frames[0]);
  icon.alt = '';
  icon.decoding = 'async';
  icon.title = e.levelName;
  const cue = creatureCue(e, glow);
  const fit = (): void => {
    applyCue(icon, cue, bestiaryIconScale(e.levelId, e.creature.id, {
      width: icon.naturalWidth,
      height: icon.naturalHeight,
    }));
  };
  applyCue(icon, cue, 1);
  if (icon.complete && icon.naturalWidth > 0) fit();
  else icon.addEventListener('load', fit, { once: true });
  return icon;
}

/** The page header for a creature: its own body, its name, and which map it belongs to. */
function creatureHead(e: BestiaryEntry): HTMLDivElement {
  const head = document.createElement('div');
  head.className = 'pedia__page-head';
  const icon = creatureIcon(e, 'pedia__page-icon pedia__page-icon--enemy', true);
  const title = document.createElement('div');
  title.className = 'pedia__page-name';
  title.textContent = e.name;
  const k = document.createElement('div');
  k.className = 'pedia__page-kind pedia__page-kind--enemy';
  k.textContent = e.levelName;
  const words = document.createElement('div');
  words.append(title, k);
  head.append(icon, words);
  return head;
}

/**
 * ONE BODY PER LEVEL, each from that level's OWN creature table.
 *
 * Variants and ranks are properties of the machinery, not of a creature, so a page needs some body
 * to put the cue on. This used to be a single hardcoded `enemy_01` - a Kenney scrap machine - and
 * with two maps that was a repurposing: it told a Mossy player that a swift moss creature looks
 * like a truck. Now the Scrapyard's body comes from the Scrapyard's table and Mossy's from Mossy's,
 * side by side, and nothing on this screen represents a creature it is not.
 *
 * Unplayable levels are skipped: a page is written about things you can actually meet.
 */
function bodyRow(cue: BodyCue, cls: string): HTMLSpanElement {
  const row = document.createElement('span');
  row.className = 'pedia__bodies';
  for (const level of LEVEL_CATALOG) {
    if (!level.playable) continue;
    const icon = document.createElement('img');
    icon.className = cls;
    // `frames[0]` is the healthy frame. A bestiary body is never a damaged one - the stages exist
    // to be discovered in a fight, and the Scrapopedia does not spoil an ascension either.
    icon.src = spriteUrl(level.creatures[level.bestiaryBody].frames[0]);
    icon.alt = '';
    icon.decoding = 'async';
    // The level's name, so a body that is unfamiliar can be identified rather than guessed at.
    icon.title = level.name;
    // CONTENT, NOT CANVAS. `object-fit: contain` fits the whole PNG, and a Kenney unit is a small
    // figure inside a large empty one - so without this correction the two bodies in this row are
    // wrong relative to each other by about 2.7x while being the same size in play. Applied on
    // load because it needs the image's natural dimensions.
    const fit = (): void => {
      applyCue(icon, cue, bestiaryIconScale(level.id, level.bestiaryBody, {
        width: icon.naturalWidth,
        height: icon.naturalHeight,
      }));
    };
    applyCue(icon, cue, 1);
    if (icon.complete && icon.naturalWidth > 0) fit();
    else icon.addEventListener('load', fit, { once: true });
    row.appendChild(icon);
  }
  return row;
}

function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * HOW A BODY IS DRAWN in this screen: how much bigger than a plain runt, and what colour cue it
 * carries. Derived from the catalog's own render hints so the row teaches what the battlefield
 * teaches - the size step, the Heavy's cool tinge, the Spiky's red rim, the boss outline.
 */
interface BodyCue {
  readonly scale: number;
  readonly filter: string;
}

/**
 * The tint, approximated as a CSS filter.
 *
 * A filter, not the exact multiply the renderer does. Reproducing that in CSS means masking the
 * sprite's alpha and blending a colour over it - three elements and a blend mode for a 34 px icon.
 * What has to survive is the DIRECTION of the tint: the Heavy leans cool and the Swarmer leans
 * warm, and telling those apart is the entire job of the cue. Deciding by whether red outweighs
 * blue is enough for that, and it stays right if a tint is retuned.
 */
function tintFilter(tint: number): string {
  if (tint === 0xffffff) return '';
  const r = (tint >> 16) & 0xff;
  const b = tint & 0xff;
  return r > b
    ? 'sepia(0.5) saturate(1.7) hue-rotate(-12deg) brightness(1.05)'
    : 'saturate(0.3) brightness(0.92)';
}

function flavourCue(f: FlavourDef): BodyCue {
  return {
    scale: f.renderScale,
    // The rim wins over the tint when a flavour somehow had both: it is the only cue for a stat
    // nothing else shows, and no flavour has both today.
    filter: f.renderGlow
      ? 'drop-shadow(0 0 4px #ff5a4a) drop-shadow(0 0 2px #ff5a4a)'
      : tintFilter(f.renderTint),
  };
}

/**
 * Ranks are 1x / 1.5x / 2.9x on the field, which a 34 px icon cannot show honestly - a boss at
 * true scale is three times the row. Compressed to a quarter of the step so the ORDER is legible
 * without the icon pretending to be to scale, and the boss carries its blue outline instead, which
 * is the cue a player actually picks it out by.
 */
function rankCue(r: RankDef): BodyCue {
  return {
    scale: 1 + (r.size - 1) * 0.25,
    filter: r.name === 'boss' ? 'drop-shadow(0 0 5px #4fa8ff) drop-shadow(0 0 2px #4fa8ff)' : '',
  };
}

function applyCue(icon: HTMLImageElement, cue: BodyCue, extra: number): void {
  icon.style.transform = `scale(${(cue.scale * extra).toFixed(2)})`;
  if (cue.filter !== '') icon.style.filter = cue.filter;
}

/** The page header for a horde entry: each level's own body, carrying the variant's render cues. */
function bodyHead(name: string, kind: string, cue: BodyCue): HTMLDivElement {
  const head = document.createElement('div');
  head.className = 'pedia__page-head';
  const icon = bodyRow(cue, 'pedia__page-icon pedia__page-icon--enemy');
  const title = document.createElement('div');
  title.className = 'pedia__page-name';
  title.textContent = name;
  const k = document.createElement('div');
  k.className = 'pedia__page-kind pedia__page-kind--enemy';
  k.textContent = kind;
  const words = document.createElement('div');
  words.append(title, k);
  head.append(icon, words);
  return head;
}

function grid(entries: readonly HTMLButtonElement[]): HTMLDivElement {
  const d = document.createElement('div');
  d.className = 'pedia__grid';
  for (const e of entries) d.appendChild(e);
  return d;
}

function section(text: string): HTMLDivElement {
  const d = document.createElement('div');
  d.className = 'pedia__section';
  d.textContent = text;
  return d;
}
