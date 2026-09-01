/**
 * THE SOUND SET - every clip the game needs, and the exact prompt that makes it.
 *
 * ---------------------------------------------------------------------------------------------
 * ONE FILE, THREE CONSUMERS
 * ---------------------------------------------------------------------------------------------
 * `brief.html` renders it as a spec sheet, `generate.mjs` feeds it to the ElevenLabs API, and
 * `picker.html` lays the takes out to choose between. All three read THIS, so a prompt cannot be
 * changed in one place and generated from another - which is exactly what went wrong on the first
 * pass, when the picker and the catalog disagreed about what had been decided.
 *
 * A CLASSIC SCRIPT, NOT A MODULE, and that is not laziness. Both HTML pages are opened straight
 * off disk as `file://`, where a browser refuses `fetch` and refuses ES module imports but loads a
 * plain `<script src>` quite happily. Node reads the text and evaluates it (see generate.mjs), so
 * the one shape that works everywhere is the oldest one.
 *
 * ---------------------------------------------------------------------------------------------
 * THE FIELDS
 * ---------------------------------------------------------------------------------------------
 *   id         the filename stem. `fire_cannon` becomes fire_cannon.mp3 in public/sfx/, and
 *              fire_cannon_1..4 in sfx/takes/ while it is still being chosen.
 *   secs       ElevenLabs `duration_seconds`, and the API's floor is 0.5 - the two clips that
 *              wanted to be shorter (a menu tick, a gem chime) are generated at 0.5 and trimmed
 *              on the way to public/sfx/, which is the right order anyway: silence is cheaper to
 *              remove than length is to add. It generates to length, so this is a decision about
 *              the sound rather than a hint - a 3 s gem pickup is a wrong gem pickup.
 *   influence  ElevenLabs `prompt_influence`, 0..1. High where the prompt is mostly PROHIBITIONS
 *              ("no organic sound", "loops seamlessly"), because those are what a low setting
 *              quietly discards. Lower on the abstract ones, which have no real-world referent and
 *              want room to find something.
 *   repeats    plays often enough that a second take would read as variation rather than as a
 *              mistake. Where an A/B pair earns its keep, if we ever buy one.
 *   prompt     describes the SOUND, never the fiction. The model has no idea what a mech is.
 *
 *              AND SAY IT IS FOR A VIDEO GAME. Left unsaid, the model reaches for a cinematic
 *              field recording - long, wide, reverberant, impressive on its own and useless
 *              layered twenty deep behind a horde. "Video game sound effect" up front asks for the
 *              thing actually wanted: short, dry, stylised and readable in a mix. This was found
 *              the expensive way, after five passes at the missile racks came back sounding like
 *              a war film every time.
 */
const SFX_SET = [
  // -------------------------------------------------------------------------------------------
  // Weapons firing - one per weapon. The one place the Vampire Survivors shape is rejected: it
  // covers fourteen guns with five firing classes, and sharing made the Mortar and the Cannon the
  // same event. The guns are what a player hears most.
  // -------------------------------------------------------------------------------------------
  { s: 'weapons', id: 'fire_cannon', name: 'Cannon', when: 'One heavy shell, about one a second', secs: 2, influence: 0.75, repeats: false,
    prompt: 'Single heavy tank cannon shot. Deep percussive thump with a hard metallic crack on the front, tight low-end punch, fast decay, dry with almost no reverb tail. Mechanical, not cinematic.' },
  { s: 'weapons', id: 'fire_mg', name: 'Machine Gun', when: 'A two-round burst, 11 times a second', secs: 1, influence: 0.75, repeats: true,
    prompt: 'Two rapid gunshots from a heavy machine gun, fired as one burst. Sharp cracking muzzle reports close together with a brassy casing rattle behind them. Dry, punchy, no tail, meant to repeat rapidly.' },
  { s: 'weapons', id: 'fire_flak', name: 'Flak Cannon', when: 'Four shells into a wide cone', secs: 1.5, influence: 0.75, repeats: false,
    prompt: 'Four rapid gunshots from an autocannon, fired as one ragged burst rather than in time. Hard muzzle blasts with a hollow metallic ring on each, slight overlap, dry short tail.' },
  { s: 'weapons', id: 'fire_mortar', name: 'Mortar', when: 'One shell lobbed high, every two seconds', secs: 2, influence: 0.75, repeats: false,
    prompt: 'Heavy mortar round leaving a steel tube. Solid concussive thump with a hollow metallic ring inside it and a fast pressurised gust following the round out. Weighty and percussive, close, with a short tail.' },
  { s: 'weapons', id: 'fire_artillery', name: 'Heavy Artillery', when: 'Two shells called down from off-map', secs: 2.5, influence: 0.75, repeats: false,
    prompt: 'Distant heavy artillery battery firing two rounds. Huge muffled booms from far away, long low rumble underneath, slight air pressure wash. Nothing sharp or close.' },
  { s: 'weapons', id: 'fire_missile_s', name: 'Short Missiles', when: 'Two tubes, every three seconds', secs: 2, influence: 0.75, repeats: false,
    prompt: 'Two short-range rockets launching from a compact tube pod. Hard pop as each clears its tube, immediate rocket motor ignition, tight hiss departing fast. Close, dry and mechanical, no explosion.' },
  { s: 'weapons', id: 'fire_missile_l', name: 'Long Missiles', when: 'Five tubes, every four seconds', secs: 2.5, influence: 0.7, repeats: false,
    prompt: 'Video game sound effect: a missile rack firing five missiles from its tubes in a fast ripple. Punchy and stylised - a crisp tube pop and a short motor hiss for each, staggered quickly. Clean, dry and readable in a busy mix, not a realistic recording and not cinematic.' },
  { s: 'weapons', id: 'fire_laser_s', name: 'Short Laser', when: 'A continuous beam - seamless loop', secs: 2, influence: 0.85, repeats: false,
    prompt: 'Seamless loop of a compact energy beam. Steady mid-bright electrical hum with a fine crackling edge, no pitch drift, no start or end transient. Must loop without a seam.' },
  { s: 'weapons', id: 'fire_laser_m', name: 'Medium Laser', when: 'A continuous beam - seamless loop', secs: 2, influence: 0.85, repeats: false,
    prompt: 'Seamless loop of a mid-power energy beam. Thicker electrical tone than a small one, warm sustained hum with a fizzing overtone, perfectly even, no transients at either end.' },
  { s: 'weapons', id: 'fire_laser_l', name: 'Long Laser', when: 'A continuous beam - seamless loop', secs: 2, influence: 0.85, repeats: false,
    prompt: 'Seamless loop of a heavy sustained energy beam. Thick, dense electrical tone with a deep low throb and a bright crackling top layer, powerful and even, no start or stop, loops cleanly.' },
  { s: 'weapons', id: 'fire_phase', name: 'Phase Cannon', when: 'A slow energy bolt, every 1.6s', secs: 1.0, influence: 0.6, repeats: false,
    prompt: 'One short burst from an exotic energy weapon. Quick descending synthetic zap with a glassy metallic ring and a brief sub-bass drop, cold and crystalline. Abrupt, no explosion, no tail.' },
  { s: 'weapons', id: 'fire_plasma', name: 'Plasma Thrower', when: 'A stream of bolts, four a second', secs: 1, influence: 0.75, repeats: true,
    prompt: 'Short burst of superheated plasma leaving a nozzle. Wet electrical spit with a gassy hiss and a hot fizzle, no metal and no crack. Very short, designed to repeat quickly.' },
  { s: 'weapons', id: 'fire_sludge', name: 'Toxic Sludge', when: 'A lobbed canister, every 1.5s', secs: 1.5, influence: 0.75, repeats: false,
    prompt: 'A canister of thick liquid launched and leaving the tube. Wet plop with a heavy splat underneath and a short sloshing gurgle. Viscous and chemical, no explosion, no metal ring.' },
  { s: 'weapons', id: 'fire_drone', name: 'Drones', when: 'A drone released from the bay', secs: 1.5, influence: 0.75, repeats: false,
    prompt: 'Small drone launching from a mechanical bay. Servo whirr, a light clamp release clack, then rotor spin-up rising in pitch. Clean and robotic, no engine roar.' },

  // -------------------------------------------------------------------------------------------
  // Hits - by damage type, never by weapon. The element is already data on the gun, so the clip is
  // a lookup and a fifteenth weapon needs no fourth impact.
  // -------------------------------------------------------------------------------------------
  { s: 'impacts', id: 'hit_bullet', name: 'Solid', when: 'Cannon, machine gun, flak, on a body', secs: 0.6, influence: 0.75, repeats: true,
    prompt: 'A bullet striking a body at close range. Dull heavy impact thud with a short metallic tick and a small scatter after it. Extremely short, dry, no ring-out.' },
  { s: 'impacts', id: 'hit_laser', name: 'Energy', when: 'Any beam, and the Phase Cannon', secs: 0.6, influence: 0.75, repeats: false,
    prompt: 'Classic science fiction laser bolt striking metal. Bright electrical zap on contact with a searing sizzle and a quick spark scatter. Short, punchy and dry.' },
  { s: 'impacts', id: 'hit_plasma', name: 'Incendiary', when: 'Plasma bolts, and anything that sets a burn', secs: 0.8, influence: 0.75, repeats: false,
    prompt: 'Ball of plasma bursting on a hard surface. Wet fiery splat with a gassy whoosh and a lingering ember crackle. Hot and sticky, no metallic ring.' },

  // -------------------------------------------------------------------------------------------
  // Explosions - graded by blast radius rather than sourced per weapon.
  // -------------------------------------------------------------------------------------------
  { s: 'blasts', id: 'blast_small', name: 'Small blast', when: 'Flak shells, short missiles, a drone dying', secs: 1, influence: 0.75, repeats: false,
    prompt: 'Small sharp explosion. Tight crack with a compact low thump and a fast debris patter, minimal tail. Close and contained.' },
  { s: 'blasts', id: 'blast_medium', name: 'Medium blast', when: 'Phase Cannon, mortar shells', secs: 1.8, influence: 0.75, repeats: false,
    prompt: 'Mid-sized high-explosive burst. Solid cracking front with a rounded low boom and scattering debris, moderate tail. Weighty but not huge.' },
  { s: 'blasts', id: 'blast_large', name: 'Large blast', when: 'Artillery, long missiles', secs: 2.5, influence: 0.75, repeats: false,
    prompt: 'Large high-explosive detonation. Hard cracking front, deep chest-hitting boom, rolling debris and a long low rumble decaying away. Powerful and wide.' },
  { s: 'blasts', id: 'splat_acid', name: 'Caustic pool', when: 'A sludge canister bursting into a puddle', secs: 1.2, influence: 0.75, repeats: false,
    prompt: 'Thick corrosive liquid bursting and spreading across a surface. Heavy wet splatter followed by sustained chemical fizzing and bubbling. No explosion.' },

  // -------------------------------------------------------------------------------------------
  // Pickups and progression - the densest section, on purpose. Getting stronger should make more
  // distinct noises than fighting does; that is the most transferable thing in the VS teardown.
  // -------------------------------------------------------------------------------------------
  { s: 'pickups', id: 'pick_gem', name: 'XP core', when: 'Every gem collected - the most frequent sound in the game', secs: 0.5, influence: 0.75, repeats: true,
    prompt: 'Tiny bright pickup chime. Single soft synthetic blip with a short crystalline ring, gentle and warm. Very quiet and very short, pleasant on the fiftieth repeat.' },
  { s: 'pickups', id: 'pick_credit', name: 'Credits', when: 'A blue coin walked over', secs: 0.6, influence: 0.75, repeats: false,
    prompt: 'Small handful of metal coins collected. Light metallic clink with a short bright shimmer. Clean and satisfying, no music.' },
  { s: 'pickups', id: 'pick_repair', name: 'Spanner', when: 'A repair pickup, hull restored', secs: 1, influence: 0.75, repeats: false,
    prompt: 'Mechanical repair confirmation. Ratchet click followed by a warm rising hum and a soft pressurised hiss, like a system coming back online.' },
  { s: 'pickups', id: 'pick_magnet', name: 'Magnet', when: 'The magnet powerup starting its sweep', secs: 0.8, influence: 0.6, repeats: false,
    prompt: 'Electromagnet snapping on. Fast rising electrical whoosh with a bright magnetic warble, energetic and immediate. Short and lively.' },
  { s: 'pickups', id: 'pick_dice', name: 'Dice', when: 'The reroll die, once a run', secs: 1, influence: 0.75, repeats: false,
    prompt: 'Single die tumbling and settling on metal. Light clattering roll, two bounces, a final tick. Dry and small.' },
  { s: 'pickups', id: 'pick_sheep', name: 'Sheep', when: 'Mossy Mayhem’s loot prop, caught', secs: 0.8, influence: 0.6, repeats: false,
    prompt: 'A clockwork sheep bleating once. Half a real bleat, half a wind-up mechanism, ending in a tiny spring rattle. Comic, brief and toy-like.' },
  { s: 'pickups', id: 'level_up', name: 'Level up', when: 'A level gained, the card about to open', secs: 1.5, influence: 0.7, repeats: false,
    prompt: 'Classic 16-bit SNES role-playing game level-up fanfare. Bright chiptune arpeggio rising over a short triumphant chord, warm synthesized instruments, nostalgic and celebratory.' },
  { s: 'pickups', id: 'card_taken', name: 'Upgrade taken', when: 'A card chosen from the level-up screen', secs: 1.2, influence: 0.75, repeats: false,
    prompt: 'Equipment being installed and locking home. Solid mechanical latch, a short servo whirr, then a bright two-note confirmation. Satisfying and final.' },
  { s: 'pickups', id: 'chest_open', name: 'Cyber Chest', when: 'A chest opening - the run stops for it', secs: 3, influence: 0.7, repeats: false,
    prompt: 'Heavy armoured container unlocking and opening. Deep mechanical clunk, servo-driven lid rising, pressurised hiss, ending on a bright electronic reward tone.' },
  { s: 'pickups', id: 'ascend', name: 'Ascension', when: 'A weapon reaching tier 8 - the one secret in the game', secs: 2.5, influence: 0.6, repeats: false,
    prompt: 'Rare and significant power-up transformation. Deep charging swell rising into a bright resonant chime, with a hard energised snap at the peak. Grander than an ordinary upgrade, no fanfare.' },
  { s: 'pickups', id: 'achievement', name: 'Achievement', when: 'An achievement unlocking, over whatever is happening', secs: 1.5, influence: 0.7, repeats: false,
    prompt: 'Short achievement notification. Two clean ascending synthetic tones with a soft sparkle tail. Bright and distinct, must cut through other sound, no music.' },

  // -------------------------------------------------------------------------------------------
  // Bodies. Enemies are MACHINES - nothing here may be organic. That is exactly what went wrong on
  // the last pass, when elite deaths came back as barks.
  // -------------------------------------------------------------------------------------------
  { s: 'bodies', id: 'die_grunt', name: 'Machine destroyed', when: 'Any regular enemy dying - plays constantly', secs: 0.7, influence: 0.8, repeats: true,
    prompt: 'Small robot breaking apart. Short metallic crunch with a brief electrical fizzle and light scrap clatter. Mechanical only, no organic sound at all. Very short.' },
  { s: 'bodies', id: 'die_elite', name: 'Elite destroyed', when: 'An elite dying', secs: 1.5, influence: 0.8, repeats: false,
    prompt: 'Larger armoured machine being destroyed. Heavy metal rupture, sparking electrical discharge, servos winding down, debris falling. Entirely mechanical - no creature or animal sound.' },
  { s: 'bodies', id: 'player_hurt', name: 'Hull hit', when: 'The mech taking damage', secs: 0.8, influence: 0.75, repeats: false,
    prompt: 'Heavy armour plate taking a hit, heard from inside the cockpit. Dull structural bang with a metallic shudder and a brief warning blip. Muffled and physical.' },
  { s: 'bodies', id: 'shield_break', name: 'Shield broken', when: 'An energy shield rim going down', secs: 1, influence: 0.75, repeats: false,
    prompt: 'Science fiction energy shield dropping. Bright synthetic crack as the field fails, electrical discharge, then a fast descending power-down whine. Cold and clean.' },

  // -------------------------------------------------------------------------------------------
  // Bosses and set pieces.
  // -------------------------------------------------------------------------------------------
  { s: 'bosses', id: 'boss_warn', name: 'Boss arriving', when: 'The cycle boss walking in', secs: 2.5, influence: 0.4, repeats: false,
    prompt: 'Dramatic tension sting announcing something dangerous arriving. Three deep synthesized hits descending in pitch, each heavier than the last, over a dark sustained drone that swells underneath and cuts off sharply.' },
  { s: 'bosses', id: 'die_boss', name: 'Boss destroyed', when: 'A boss going down', secs: 3, influence: 0.8, repeats: false,
    prompt: 'A large machine breaking down for good. Structural groan and tearing metal, one solid internal blast, systems spinning down into silence. Mechanical and restrained, not a huge cinematic explosion.' },
  { s: 'bosses', id: 'event_swarm', name: 'Swarm incoming', when: 'The swarm set-piece starting', secs: 1.2, influence: 0.7, repeats: false,
    prompt: 'Short warning of a fast group approaching. Quick rising urgent electronic pulse over a brief mechanical skittering rush. Tense and abrupt, no music, no voices.' },

  // -------------------------------------------------------------------------------------------
  // Run outcomes - heard once each, so both may be long and neither needs a second take.
  // -------------------------------------------------------------------------------------------
  { s: 'outcomes', id: 'run_lost', name: 'Mech destroyed', when: 'The run ending in failure', secs: 3, influence: 0.75, repeats: false,
    prompt: 'Large mech shutting down for good. Grinding servo failure, hydraulics venting, a heavy collapse onto the ground, then a descending power-down whine into silence.' },
  { s: 'outcomes', id: 'run_won', name: 'Extraction', when: 'Surviving the clock with every boss down', secs: 3, influence: 0.6, repeats: false,
    prompt: 'Triumphant mechanical resolution. Systems powering up and stabilising, a warm rising synthetic chord, ending on a clean sustained tone. Earned rather than fanfare.' },

  // -------------------------------------------------------------------------------------------
  // World and interface.
  // -------------------------------------------------------------------------------------------
  { s: 'world', id: 'barrel_break', name: 'Fuel drum', when: 'A drum shot open', secs: 1.2, influence: 0.75, repeats: false,
    prompt: 'Fuel barrel rupturing and igniting. Metallic burst, brief fiery whoomp, liquid spill and a short debris rattle.' },
  { s: 'world', id: 'wall_break', name: 'Terrain broken', when: 'A tree felled, a site fence opened', secs: 1.2, influence: 0.75, repeats: true,
    prompt: 'Heavy structure giving way and falling. Splintering crack, a dry collapse, then scattered debris settling. Dusty and blunt, no explosion, no metal ring.' },
  { s: 'world', id: 'reload', name: 'Reloaded', when: 'A magazine weapon coming back online', secs: 1, influence: 0.75, repeats: false,
    prompt: 'Heavy weapon reload. Magazine seating with a solid clunk, bolt cycling forward, a final mechanical latch. Dry and precise.' },
  { s: 'world', id: 'overheat', name: 'Overheated', when: 'A beam weapon cutting out', secs: 1.2, influence: 0.75, repeats: false,
    prompt: 'A battlemech overheating. Insistent warning klaxon over a rising strained whine, then a hard pressurised steam vent as the system shuts down.' },
  { s: 'world', id: 'ui_move', name: 'Menu move', when: 'Cursor moving between options', secs: 0.5, influence: 0.75, repeats: true,
    prompt: 'Minimal interface tick. Single dry synthetic click, soft and low, no pitch. Extremely short and quiet.' },
  { s: 'world', id: 'ui_confirm', name: 'Menu confirm', when: 'An option chosen', secs: 0.5, influence: 0.75, repeats: false,
    prompt: 'Interface confirmation. Short two-tone synthetic blip rising slightly, clean and dry, no reverb.' },
  { s: 'world', id: 'ui_deny', name: 'Menu refused', when: 'Something unaffordable or locked', secs: 0.5, influence: 0.75, repeats: false,
    prompt: 'Interface rejection. Short flat two-tone synthetic buzz falling in pitch, dull and closed. Dry, no reverb, not harsh.' },
];

/** Section headings and the note that explains each, in display order. */
const SFX_SECTIONS = [
  ['weapons', 'Weapons firing', 'one per weapon',
   'Every gun gets its own report. This is the one place the Vampire Survivors shape is rejected: it covers fourteen guns with five firing classes, and sharing made the Mortar and the Cannon the same event.'],
  ['impacts', 'Hits & impacts', 'by damage type',
   'Impact follows the damage, never the weapon - the element is already data on the gun, so the clip is a lookup. A fifteenth weapon needs no fourth.'],
  ['blasts', 'Explosions', 'graded',
   'Graded by blast radius rather than sourced per weapon, so a new gun needs a size and not a recording. The fourth is the sludge, which is a spill rather than a blast.'],
  ['pickups', 'Pickups & progression', 'the densest section',
   'On purpose: getting stronger should make more distinct noises than fighting does. That is the single most transferable thing in the VS map - 24 clips for the reward loop against 12 for hits.'],
  ['bodies', 'Bodies', 'machines only',
   'Enemies are machines. Nothing here may be organic - no squelch, no breath, no animal. That is exactly what went wrong on the last pass, when elite deaths came back as barks.'],
  ['bosses', 'Bosses & set pieces', '',
   'Single sounds for now. VS phrases its set pieces as anticipation, impact, finisher - the obvious next thing to buy, and deliberately not in this list.'],
  ['outcomes', 'Run outcomes', '',
   'The two ways a run ends. Both are heard once, so both may be long and neither needs a second take.'],
  ['world', 'World & interface', '',
   'Everything that is neither a gun nor a body. The three UI clips are the only sounds a player hears with the game paused, so they want to be dry and quiet.'],
];

if (typeof window !== 'undefined') {
  window.SFX_SET = SFX_SET;
  window.SFX_SECTIONS = SFX_SECTIONS;
}
