/**
 * `npm run icons` - draws one icon per upgrade into public/sprites/, for the Cyber Chest's reels.
 *
 * ONE SYMBOL PER CARD, and they exist because a slot machine has to be read at a glance while it
 * is moving. The level-up card can afford a name and a sentence; a reel cannot, so each of these has
 * to say "Long Laser" or "Ablative Plate" from its silhouette and its colour alone, at 64 pixels,
 * blurred by motion, in the half second it is stationary before the next one lands.
 *
 * ---------------------------------------------------------------------------------------------
 * THE RULES THAT KEEP THEM DISTINGUISHABLE FROM EACH OTHER
 * ---------------------------------------------------------------------------------------------
 *   COLOUR IS THE CATEGORY - EXCEPT FOR THE LASERS, WHICH WEAR THEIR OWN BEAM. Weapons are amber
 *     and passives are blue, the same split the level-up cards use (`--accent` against
 *     `--accent-sys`) and the same split the chest's payout table cares about, so two amber and
 *     one blue tells a player what they scored before the number appears.
 *
 *     The four laser icons take the exact colour their beam is drawn in - green, blue, red - so
 *     the symbol on the reel is the light the player has been staring at for ten minutes. That is
 *     a stronger identity than the category is: nobody confuses a Long Laser with a Cannon, but
 *     three amber bars of different lengths were always going to be confusable with EACH OTHER
 *     while moving.
 *
 *     THE PLATE STILL WEARS THE CATEGORY, and that is load-bearing rather than tidy. A chest pays
 *     4 for a pair sharing a KIND and 2 for three different symbols sharing one, so the amber /
 *     blue split on the border is how a player reads the payout off the reels before the word
 *     appears. Colouring the whole tile by beam - which is where this started - would have made a
 *     green laser and a blue laser look like two categories and quietly broken that. So: the
 *     border says gun or system, the glyph says WHICH.
 *   ONE SHAPE IDEA EACH. Not a small picture of the weapon - a single geometric gesture. Three
 *     lasers that differed only in barrel length would be three identical icons in motion; they
 *     differ in BEAM LENGTH AND COUNT instead, which survives being 64 px and moving.
 *   NOTHING TOUCHES THE EDGE. Each is drawn inside a rounded plate with a margin, so a column of
 *     them reads as a column of tiles rather than as a texture.
 *
 * The lasers are the hardest case and are worth stating explicitly: short is one stub, medium is
 * one longer bar, long is one full-width bar with a lens flare at the muzzle, and the Chain Laser
 * is the medium's bar bent through two nodes. Length IS the weapon, which is also true in the
 * game - and now so is colour.
 *
 * THE COLOURS ARE IMPORTED, NOT COPIED. `beamColour` comes out of WEAPON_CATALOG, so an icon
 * cannot drift from the beam it is supposed to be a picture of. That is why this script runs
 * under tsx rather than bare node.
 *
 * NEVER run `npx playwright install` here - browsers are preinstalled at /opt/pw-browsers.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WEAPON_CATALOG } from '../src/core/content/weaponCatalog.ts';

/**
 * Upgrade id -> the beam colour that weapon actually draws with, straight from the catalog.
 *
 * The Chain Laser is the Medium Laser at tier 8 - one WeaponDef, one beam, one colour - so it
 * takes its entry from the same weapon rather than declaring a colour of its own.
 */
const hex = (n) => `#${n.toString(16).padStart(6, '0')}`;
const beamOf = (weaponId) => {
  const def = WEAPON_CATALOG.find((w) => w.id === weaponId);
  if (def === undefined) throw new Error(`make-icons: no weapon "${weaponId}" in WEAPON_CATALOG`);
  return hex(def.beamColour);
};
const LASER_KEY = {
  'w-laser-short': beamOf('laser-short'),
  'w-laser-medium': beamOf('laser-medium'),
  'w-laser-long': beamOf('laser-long'),
  'w-chain-laser': beamOf('laser-medium'),
  'w-giga-laser': beamOf('laser-long'),
};

/**
 * The plate border and every dimmed stroke, at the same ratio the hand-picked amber pair already
 * used (0xf0b429 -> 0x8a6415 is about 0.55 per channel). Derived rather than authored so a new
 * beam colour needs no second hex value.
 */
const DIM = 0.55;
const dimHex = (h) => {
  const n = parseInt(h.slice(1), 16);
  const ch = (shift) => Math.round(((n >> shift) & 0xff) * DIM);
  return hex((ch(16) << 16) | (ch(8) << 8) | ch(0));
};

const OUT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'sprites');

/** 128 px, drawn for a reel that shows them at about 64 CSS px on a 3x phone. */
const S = 128;

/**
 * Upgrade id -> icon key. The renderer maps a reel's catalog index through `UpgradeDef.id`, so
 * these strings must match src/core/data/upgrades.ts exactly. A missing one draws nothing rather
 * than throwing, but it is a blank tile on a slot machine, which is worse than an ugly one.
 */
const ICONS = [
  'w-cannon',
  'w-missile-short',
  'w-missile-long',
  'w-machine-gun',
  'w-flak-cannon',
  'w-artillery',
  'w-drone',
  'w-phase-cannon',
  // TIER 8, the Cannon's. Not a card in the deck - see the two other tier-8 icons above for why
  // an ascension still needs a picture of its own: the reel has to say the thing in your hands
  // is not the thing you were carrying.
  'w-twin-mount',
  'w-laser-short',
  'w-laser-medium',
  'w-laser-long',
  // TIER 8. Not a card in the deck - it is the Medium Laser's ascension - but it needs an icon of
  // its own, because the whole point of a tier 8 is that the thing in your hands is not the thing
  // you were carrying.
  'w-chain-laser',
  // TIER 8 AGAIN - the Long Missiles'. Same reason: the thing in your hands is not the thing you
  // were carrying, and the reel has to say so.
  'w-gtm-hornet',
  // TIER 8 AGAIN - the Long Laser's. Same reason again.
  'w-giga-laser',
  'p-range',
  'p-damage',
  'p-rate',
  'p-speed',
  'p-armour',
  'p-shield',
  'p-repair',
  'p-radiator',
  'p-blast',
];

const DRAW = `(id) => {
  const LASER_KEY = ${JSON.stringify(LASER_KEY)};
  const LASER_DIM = ${JSON.stringify(
    Object.fromEntries(Object.entries(LASER_KEY).map(([k, v]) => [k, dimHex(v)])),
  )};
  const S = ${S};
  const c = document.createElement('canvas');
  c.width = S; c.height = S;
  const g = c.getContext('2d');
  const CX = S / 2, CY = S / 2;

  const WEAPON = id.charAt(0) === 'w';
  // A laser wears its own beam; everything else wears its category. See the header.
  const LASER = LASER_KEY[id];
  const KEY      = LASER ?? (WEAPON ? '#f0b429' : '#4fa8ff');
  const KEY_DIM  = WEAPON ? '#8a6415' : '#25597f';
  const PLATE    = '#161b23';
  const PLATE_HI = '#232b36';
  const STEEL    = '#8f98a6';
  // The missile art's own palette, sampled from public/sprites/missile.png. Hardcoded rather than
  // read back out of the PNG: the file is checked in and static, and a canvas script that had to
  // decode an image to pick a fill would be a build step for four hex values.
  const MISSILE_BODY  = '#bdd6db';
  const MISSILE_SHADE = '#a1b6bb';
  const MISSILE_EDGE  = '#78888c';
  const MISSILE_FIN   = '#36bbf5';

  // --- the tile ------------------------------------------------------------------------------
  const rr = (x, y, w, h, r) => {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  };
  const M = 6;
  rr(M, M, S - M * 2, S - M * 2, 16);
  g.fillStyle = PLATE; g.fill();
  g.strokeStyle = KEY_DIM; g.lineWidth = 3; g.stroke();
  rr(M + 4, M + 4, S - M * 2 - 8, (S - M * 2) * 0.42, 12);
  g.fillStyle = PLATE_HI; g.fill();

  g.lineCap = 'round';
  g.lineJoin = 'round';

  const bar = (x, y, w, h, fill) => { g.fillStyle = fill; g.fillRect(x, y, w, h); };
  const beam = (len, thick) => {
    // A muzzle block on the left, then a beam running right. Length and thickness ARE the weapon.
    bar(26, CY - 9, 14, 18, STEEL);
    g.fillStyle = KEY;
    g.fillRect(40, CY - thick / 2, len, thick);
    g.globalAlpha = 0.35;
    g.fillRect(40, CY - thick, len, thick * 2);
    g.globalAlpha = 1;
  };

  // --- weapons -------------------------------------------------------------------------------
  if (id === 'w-cannon') {
    // One fat shell, nose up. The heaviest single round in the game gets the heaviest single shape.
    g.fillStyle = KEY;
    g.beginPath();
    g.moveTo(CX, 30);
    g.quadraticCurveTo(CX + 17, 52, CX + 17, 74);
    g.lineTo(CX - 17, 74);
    g.quadraticCurveTo(CX - 17, 52, CX, 30);
    g.closePath(); g.fill();
    bar(CX - 19, 74, 38, 12, STEEL);
    bar(CX - 19, 88, 38, 8, KEY_DIM);
  }

  if (id === 'w-twin-mount') {
    // THE CANNON'S SHELL, TWICE - the same silhouette the player has stared at all the way up the
    // ladder, side by side and slightly slimmer so the pair fits the plate. Two of the thing you
    // know is the whole sentence: the ascension is the second barrel, nothing else changed.
    for (const sx of [-14, 14]) {
      const x = CX + sx;
      g.fillStyle = KEY;
      g.beginPath();
      g.moveTo(x, 32);
      g.quadraticCurveTo(x + 11, 50, x + 11, 72);
      g.lineTo(x - 11, 72);
      g.quadraticCurveTo(x - 11, 50, x, 32);
      g.closePath(); g.fill();
      bar(x - 12, 72, 24, 10, STEEL);
      bar(x - 12, 84, 24, 7, KEY_DIM);
    }
  }

  // ONE MISSILE, drawn centred on (x, cy). Shared by the two racks and by the Hornet, so a
  // Hornet child is literally the same silhouette a short-rack missile is drawn with.
  const missileBody = (x, cy, h, w) => {
    const top = cy - h / 2;
    const bot = cy + h / 2;
    const hw = w / 2;
    // EVERY LANDMARK IS A FRACTION OF THE LENGTH, not of the width, and that is what stops the
    // fat one turning into an egg: a nose measured off the width grows as the body widens, so
    // the short missile's dome ate half its body and the silhouette stopped being a missile at
    // exactly the proportion this icon exists to show.
    const shoulder = top + h * 0.3;
    const tailHw = hw * 0.55;
    const finTop = top + h * 0.55;
    // The fins stop SHORT OF THE TAIL, so the body protrudes below them the way the sprite's
    // does. It is a few pixels and it is most of what makes the shape read as a missile with
    // fins rather than as a dart with a skirt.
    const finBot = bot - h * 0.1;
    // 1.95 rather than the sprite's ~2.1: the SHORT icon draws two of these side by side, and at
    // a fuller span the two inner fins merged into one dark bar across the tile - which is a
    // picture of a wedge, not of two missiles.
    const finSpan = hw * 1.95;

    // FINS FIRST, so the body sits over their roots exactly as it does in the sprite.
    g.fillStyle = MISSILE_FIN;
    for (const sx of [-1, 1]) {
      g.beginPath();
      g.moveTo(x + sx * hw * 0.9, finTop);
      g.lineTo(x + sx * finSpan, finBot);
      g.lineTo(x + sx * tailHw, finBot);
      g.closePath();
      g.fill();
    }

    // BODY: ogive nose, parallel flanks, tapering to the tail.
    //
    // MID TONE FILLED, DARK OUTLINED, LIT DOWN THE CENTRELINE - which is how the sprite is
    // shaded, and doing it in that order is what makes the icon read as the same object rather
    // than as a pale cutout of its outline. Filling with the LIGHTEST tone and banding it (the
    // first attempt) put a stripe across the body that the art does not have.
    g.fillStyle = MISSILE_SHADE;
    g.strokeStyle = MISSILE_EDGE;
    g.lineWidth = 2.5;
    g.beginPath();
    g.moveTo(x, top);
    // Control point out at the full half-width and NEARLY HALF WAY DOWN THE NOSE, which leaves
    // the tip steeply and flattens to vertical at the shoulder - an ogive. A control point up
    // near the tip gives a dome, which is a pill with fins on it.
    g.quadraticCurveTo(x + hw, top + (shoulder - top) * 0.45, x + hw, shoulder);
    g.lineTo(x + tailHw, bot);
    g.lineTo(x - tailHw, bot);
    g.lineTo(x - hw, shoulder);
    g.quadraticCurveTo(x - hw, top + (shoulder - top) * 0.45, x, top);
    g.closePath();
    g.fill();
    g.stroke();

    // The lit centreline. Stops at the shoulder rather than running into the nose, so the ogive
    // still reads as a curved surface instead of a flat plate with a stripe on it.
    g.fillStyle = MISSILE_BODY;
    g.beginPath();
    g.moveTo(x - hw * 0.3, shoulder - (shoulder - top) * 0.5);
    g.lineTo(x + hw * 0.3, shoulder - (shoulder - top) * 0.5);
    g.lineTo(x + tailHw * 0.45, bot - h * 0.02);
    g.lineTo(x - tailHw * 0.45, bot - h * 0.02);
    g.closePath();
    g.fill();
  };

  if (id === 'w-gtm-hornet') {
    // THE SPLIT, DRAWN. One missile at the top, two below it fanned apart - which is the mechanic
    // and not a decoration: what a player has to recognise on a reel is that this rack's warheads
    // come in half.
    //
    // IT IS THE LONG RACK'S MISSILE ON TOP AND THE SHORT RACK'S UNDERNEATH, at the two aspect
    // ratios the icons already teach (long and thin, squat and fat). That is the whole sentence:
    // a long missile becomes two short ones. Drawing three identical bodies would say "three
    // missiles", which is what the plain long-rack icon already says.
    const parent = { x: CX, y: CY - 30, h: 46, w: 12, a: 0 };
    // +/- 7.5 degrees is the real split angle; drawn at 3x so it reads at 24 px on a reel. An icon
    // at true scale is a picture of two parallel missiles.
    const kids = [
      { x: CX - 26, y: CY + 30, h: 34, w: 19, a: -0.39 },
      { x: CX + 26, y: CY + 30, h: 34, w: 19, a: 0.39 },
    ];
    // The trail from the parent down to each child, so the eye reads the order: one, then two.
    g.strokeStyle = KEY_DIM;
    g.lineWidth = 3;
    g.setLineDash([5, 5]);
    for (const k of kids) {
      g.beginPath();
      g.moveTo(CX, CY - 6);
      g.lineTo(k.x, k.y - k.h * 0.5);
      g.stroke();
    }
    g.setLineDash([]);
    for (const m of [parent, ...kids]) {
      g.save();
      g.translate(m.x, m.y);
      g.rotate(m.a);
      missileBody(0, 0, m.h, m.w);
      g.restore();
    }
  }

  if (id === 'w-missile-short' || id === 'w-missile-long') {
    // TWO squat missiles against ONE long thin one - the same contrast the projectiles themselves
    // are drawn with in assets.ts, so the icon teaches the silhouette the player will see fly.
    //
    // AND IT IS THE SAME SHAPE NOW. These used to be flat-sided pentagons with a pair of grey tabs
    // at the base, which is a picture of the WORD missile rather than of the thing that comes off
    // the rack: the art in flight has a rounded ogive nose and a pair of big swept delta fins that
    // flare well past the body. Nose and fins are the whole silhouette, and neither was here.
    //
    // AND THE COLOURS ARE THE ART'S OWN, sampled from public/sprites/missile.png: a pale steel body
    // (#bdd6db lit, #a1b6bb shaded, #78888c edged) with vivid blue delta fins (#36bbf5 over
    // #1884b4). This is the same licence the lasers take - see the header. The BORDER still says
    // amber, so the tile still reads as a weapon at a glance and the chest's kind-matching payout
    // is untouched; the border says gun or system, the glyph says WHICH. A missile drawn in the
    // category colour was a symbol for "a weapon", and every weapon on the reels is one of those.
    const long = id === 'w-missile-long';
    // THE ICONS CARRY THE PROJECTILES' OWN ASPECT RATIOS, now that those have been pushed apart:
    // 42 x 24 is 1.75 : 1 and 66 x 17 is 3.9 : 1, against the 20 x 11.4 and 25 x 6.3 the two racks
    // actually fly at. An icon fatter than the thing it is teaching is a worse icon even when it
    // reads better on its own.
    //
    // THE COUNT IS THE VOLLEY. Two for the short rack and THREE for the long, because that is what
    // each one actually puts in the air - the same rule the level-up cards follow, where a third
    // missile is written out as a third missile and a percentage never is. The long rack drew one
    // missile for as long as it existed, which quietly made "two against one" the difference
    // between the racks when the real difference is two against three.
    if (long) { missileBody(CX - 34, CY, 64, 16); missileBody(CX, CY, 64, 16); missileBody(CX + 34, CY, 64, 16); }
    else { missileBody(CX - 25, CY, 42, 24); missileBody(CX + 25, CY, 42, 24); }
  }

  if (id === 'w-machine-gun') {
    // A stream. Rounds of decreasing size going right is the only way "many small fast" reads.
    bar(24, CY - 11, 18, 22, STEEL);
    for (let i = 0; i < 5; i++) {
      const r = 8 - i * 1.1;
      g.beginPath(); g.arc(52 + i * 14, CY, r, 0, 6.284);
      g.fillStyle = KEY; g.globalAlpha = 1 - i * 0.13; g.fill();
    }
    g.globalAlpha = 1;
  }

  if (id === 'w-drone') {
    // A quadcopter from above: four rotor discs on an X frame, one solid hull between them.
    //
    // IT IS THE ONLY GLYPH IN THE SET SYMMETRICAL ABOUT BOTH AXES, and that is the whole design.
    // A reel is read while it is moving, when nothing resolves but the gross shape - and every
    // other weapon here is a thing POINTING somewhere (a shell nose-up, a stream running right, a
    // beam, a pair of missiles). A drone is the one weapon with no facing, so the icon has none
    // either, and the eye separates it from the rest before any detail arrives.
    //
    // Deliberately NOT a small picture of the drone sprite. At 64 px the hull and the rotors would
    // merge into an amber blob; the X frame is what holds the four discs apart at that size.
    const ARM = 26;
    const CORNERS = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
    g.strokeStyle = STEEL; g.lineWidth = 7;
    g.beginPath();
    for (const [sx, sy] of [[-1, -1], [1, -1]]) {
      g.moveTo(CX + sx * ARM, CY + sy * ARM);
      g.lineTo(CX - sx * ARM, CY - sy * ARM);
    }
    g.stroke();
    for (const [sx, sy] of CORNERS) {
      const x = CX + sx * ARM, y = CY + sy * ARM;
      g.beginPath(); g.arc(x, y, 14, 0, 6.284);
      g.globalAlpha = 0.28; g.fillStyle = KEY; g.fill(); g.globalAlpha = 1;
      g.strokeStyle = KEY; g.lineWidth = 4; g.stroke();
    }
    // The hull, with the lens punched out of it - the one asymmetry-free detail that reads at size.
    g.beginPath(); g.arc(CX, CY, 17, 0, 6.284); g.fillStyle = KEY; g.fill();
    g.beginPath(); g.arc(CX, CY, 7, 0, 6.284); g.fillStyle = PLATE; g.fill();
  }

  if (id === 'w-phase-cannon') {
    // THE PASS-THROUGH, DRAWN: a dotted flight line crossing two hollow "ghost" bodies it does
    // not touch, ending in a solid plasma orb with a burst ring around it. The glyph wears the
    // bolt's own blue - the same licence the lasers and missiles take; the amber border still
    // says "weapon" for the chest's kind-matching payout.
    const PLASMA = '#55c8ff';
    const PLASMA_DIM = '#2f6e8c';
    // Ghost bodies: outline only, deliberately NOT filled - these are the enemies the bolt
    // ignores on its way.
    g.strokeStyle = STEEL;
    g.lineWidth = 3;
    for (const [gx, gr] of [[46, 10], [76, 13]]) {
      g.beginPath(); g.arc(gx, CY, gr, 0, 6.284); g.stroke();
    }
    // The flight line, dotted, straight through both.
    g.strokeStyle = PLASMA_DIM;
    g.lineWidth = 4;
    g.setLineDash([6, 6]);
    g.beginPath(); g.moveTo(20, CY); g.lineTo(96, CY); g.stroke();
    g.setLineDash([]);
    // The arrival: burst ring first, then the orb over it, with a bright core.
    g.strokeStyle = PLASMA;
    g.lineWidth = 3.5;
    g.globalAlpha = 0.55;
    g.beginPath(); g.arc(104, CY, 19, 0, 6.284); g.stroke();
    g.globalAlpha = 1;
    g.beginPath(); g.arc(104, CY, 11, 0, 6.284); g.fillStyle = PLASMA; g.fill();
    g.beginPath(); g.arc(104, CY, 5, 0, 6.284); g.fillStyle = '#d9f2ff'; g.fill();
  }

  if (id === 'w-flak-cannon') {
    // A SPRAY, and it has to read as the machine gun's opposite at a glance: the belt gun is one
    // straight line of shrinking rounds, this is the same muzzle throwing shells NOWHERE IN
    // PARTICULAR. Three ragged lines at uneven angles inside a faint cone - uneven on purpose,
    // because an evenly fanned three would draw the missile rack's tidy volley instead.
    bar(24, CY - 11, 18, 22, STEEL);
    // The cone itself, barely there: it is the volume, not the shot.
    g.globalAlpha = 0.16;
    g.fillStyle = KEY;
    g.beginPath();
    g.moveTo(42, CY);
    g.lineTo(116, CY - 40);
    g.lineTo(116, CY + 40);
    g.closePath(); g.fill();
    g.globalAlpha = 1;
    // Three shells, three different angles, three different distances along them.
    for (const [ang, far] of [[-0.42, 0.95], [-0.05, 0.7], [0.36, 0.88]]) {
      const ex = 42 + Math.cos(ang) * 72 * far;
      const ey = CY + Math.sin(ang) * 72 * far;
      g.strokeStyle = KEY_DIM; g.lineWidth = 3.5; g.lineCap = 'round';
      g.beginPath(); g.moveTo(46, CY + Math.sin(ang) * 4); g.lineTo(ex, ey); g.stroke();
      g.beginPath(); g.arc(ex, ey, 6.5, 0, 6.284); g.fillStyle = KEY; g.fill();
    }
  }

  if (id === 'w-artillery') {
    // The ring the weapon actually draws on the ground, with an arcing shell over it. Nothing else
    // in the game marks its target before it lands, so the ring alone identifies it.
    g.strokeStyle = KEY; g.lineWidth = 5;
    g.beginPath(); g.ellipse(CX, CY + 22, 34, 15, 0, 0, 6.284); g.stroke();
    g.strokeStyle = KEY_DIM; g.lineWidth = 4;
    g.beginPath();
    g.moveTo(CX - 40, CY + 20);
    g.quadraticCurveTo(CX - 6, CY - 46, CX + 22, CY + 8);
    g.stroke();
    g.beginPath(); g.arc(CX + 24, CY + 12, 7, 0, 6.284); g.fillStyle = KEY; g.fill();
  }

  if (id === 'w-laser-short') beam(22, 10);
  if (id === 'w-laser-medium') beam(46, 9);
  if (id === 'w-laser-long') {
    beam(64, 7);
    g.globalAlpha = 0.55;
    g.beginPath(); g.arc(104, CY, 13, 0, 6.284); g.fillStyle = KEY; g.fill();
    g.globalAlpha = 1;
  }

  if (id === 'w-chain-laser') {
    // THE MEDIUM LASER'S BEAM, BENT. It has to read as the same weapon at a glance - it is the
    // same gun, at tier 8 - so it keeps the emitter and the first straight run, and then the line
    // kinks twice through two nodes. The kinks ARE the mechanic: a beam that stopped being
    // straight is the one thing the player needs to recognise on a reel.
    beam(30, 9);
    const NODE = (x, y, r) => {
      g.beginPath(); g.arc(x, y, r, 0, 6.284); g.fillStyle = KEY; g.fill();
    };
    g.strokeStyle = KEY; g.lineWidth = 7; g.lineCap = 'round'; g.lineJoin = 'round';
    g.beginPath();
    g.moveTo(CX + 6, CY);
    g.lineTo(CX + 30, CY - 26);
    g.lineTo(CX + 52, CY + 16);
    g.stroke();
    // The bodies it jumped between, brightest last: the chain is going somewhere.
    g.globalAlpha = 0.85; NODE(CX + 6, CY, 7);
    g.globalAlpha = 0.92; NODE(CX + 30, CY - 26, 8);
    g.globalAlpha = 1;    NODE(CX + 52, CY + 16, 9);
  }

  if (id === 'w-giga-laser') {
    // THE LONG LASER'S BEAM AS A CHANNEL. Same emitter block, same red - it has to read as the
    // same gun - but the beam is a broad band running the whole plate, with bodies INSIDE it as
    // silhouettes. Ghost outlines are what the Phase Cannon uses for "ignored on the way"; these
    // are filled dark, because nothing in this beam's path is ignored.
    bar(22, CY - 13, 18, 26, STEEL);
    g.fillStyle = KEY;
    g.globalAlpha = 0.28;
    g.fillRect(40, CY - 22, 74, 44);
    g.globalAlpha = 0.6;
    g.fillRect(40, CY - 14, 74, 28);
    g.globalAlpha = 1;
    g.fillRect(40, CY - 6, 74, 12);
    // The covered bodies, burnt dark inside the light.
    g.fillStyle = PLATE;
    for (const [bx, br] of [[62, 6], [84, 8], [104, 5]]) {
      g.beginPath(); g.arc(bx, CY + (bx % 2 === 0 ? -4 : 5), br, 0, 6.284); g.fill();
    }
  }

  // --- passives ------------------------------------------------------------------------------
  if (id === 'p-range') {
    // Concentric arcs growing outward: reach.
    g.strokeStyle = KEY;
    for (let i = 0; i < 3; i++) {
      g.lineWidth = 5 - i;
      g.globalAlpha = 1 - i * 0.22;
      g.beginPath(); g.arc(CX - 26, CY, 22 + i * 17, -0.85, 0.85); g.stroke();
    }
    g.globalAlpha = 1;
    g.beginPath(); g.arc(CX - 26, CY, 7, 0, 6.284); g.fillStyle = KEY; g.fill();
  }

  if (id === 'p-damage') {
    // AN IMPACT BURST, not a chevron. The chevron used to be shared with p-rate - one arrow doing
    // duty for "harder" and two of the same arrow for "sooner" - which reads as the same card
    // twice rather than as two different things at a glance. A four-point spike is what a hit
    // looks like on its own terms, and it owes nothing to the rate glyph beside it.
    const R_OUT = 32, R_IN = 12;
    g.fillStyle = KEY;
    g.beginPath();
    for (let i = 0; i < 8; i++) {
      const ang = (Math.PI / 4) * i - Math.PI / 2;
      const r = i % 2 === 0 ? R_OUT : R_IN;
      const x = CX + Math.cos(ang) * r;
      const y = CY + Math.sin(ang) * r;
      if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.closePath();
    g.fill();
  }

  if (id === 'p-rate') {
    // A FAST-FORWARD prompt - three triangles racing right, fading as they go. Stands on its own
    // as "faster/again" rather than being p-damage's chevron doubled, which is what made the two
    // cards hard to tell apart on a moving reel.
    g.fillStyle = KEY;
    for (let i = 0; i < 3; i++) {
      g.globalAlpha = 1 - i * 0.22;
      const x = CX - 30 + i * 22;
      g.beginPath();
      g.moveTo(x - 12, CY - 20);
      g.lineTo(x + 12, CY);
      g.lineTo(x - 12, CY + 20);
      g.closePath();
      g.fill();
    }
    g.globalAlpha = 1;
  }

  if (id === 'p-speed') {
    // Motion lines behind a wedge. Reads as speed at any size, which is why every game uses it.
    g.fillStyle = KEY;
    g.beginPath();
    g.moveTo(CX + 30, CY);
    g.lineTo(CX - 6, CY - 26);
    g.lineTo(CX - 6, CY + 26);
    g.closePath(); g.fill();
    g.strokeStyle = KEY_DIM; g.lineWidth = 7;
    for (let i = 0; i < 3; i++) {
      const y = CY - 18 + i * 18;
      g.beginPath(); g.moveTo(CX - 44, y); g.lineTo(CX - 18 - i * 4, y); g.stroke();
    }
  }

  if (id === 'p-armour') {
    // A plate, with a bolted seam. Solid and closed, against the shield's open ring.
    g.fillStyle = KEY;
    g.beginPath();
    g.moveTo(CX, 28);
    g.lineTo(CX + 30, 42);
    g.lineTo(CX + 30, 74);
    g.quadraticCurveTo(CX + 30, 94, CX, 104);
    g.quadraticCurveTo(CX - 30, 94, CX - 30, 74);
    g.lineTo(CX - 30, 42);
    g.closePath(); g.fill();
    g.fillStyle = PLATE;
    g.fillRect(CX - 4, 40, 8, 52);
    g.fillStyle = KEY_DIM;
    for (const y of [50, 68, 86]) { g.beginPath(); g.arc(CX, y, 4, 0, 6.284); g.fill(); }
  }

  if (id === 'p-repair') {
    // A CLOCK FACE WITH A CROSS IN IT. Both halves are load-bearing and neither works alone: a
    // cross on its own is the spanner's job (heal), and a clock on its own is the rate card's. The
    // whole point of this passive is that the mending is on a TIMER, so the symbol is the timer
    // with the mending inside it.
    g.strokeStyle = KEY;
    g.lineWidth = 6;
    g.beginPath(); g.arc(CX, CY, 34, 0, 6.284); g.stroke();
    // A gap at the top, so the ring reads as a dial rather than as the shield's closed rim.
    g.strokeStyle = PLATE;
    g.lineWidth = 9;
    g.beginPath(); g.arc(CX, CY, 34, -1.9, -1.24); g.stroke();
    // The cross.
    g.fillStyle = KEY;
    g.fillRect(CX - 5, CY - 19, 10, 38);
    g.fillRect(CX - 19, CY - 5, 38, 10);
    // A hand at the top of the dial, where the clock sits while nothing is missing.
    g.strokeStyle = STEEL;
    g.lineWidth = 4;
    g.beginPath(); g.moveTo(CX, CY); g.lineTo(CX, CY - 26); g.stroke();
  }

  if (id === 'p-blast') {
    // AN EXPANDING BLAST: a bright core, a solid ring where the blast IS, and a wider fading ring
    // where the card puts it. Growth is the glyph - p-range says reach with arcs going somewhere,
    // this says AREA with circles getting bigger around a centre.
    g.fillStyle = KEY;
    g.beginPath(); g.arc(CX, CY, 9, 0, 6.284); g.fill();
    for (const [r, w, a] of [[22, 5, 1], [34, 4, 0.55], [46, 3, 0.3]]) {
      g.globalAlpha = a;
      g.strokeStyle = KEY;
      g.lineWidth = w;
      g.beginPath(); g.arc(CX, CY, r, 0, 6.284); g.stroke();
    }
    g.globalAlpha = 1;
    // Four fragments leaving the core on the diagonals, so it reads as a blast, not a target.
    g.fillStyle = KEY;
    for (const [sx, sy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      g.beginPath();
      g.arc(CX + sx * 15, CY + sy * 15, 3, 0, 6.284);
      g.fill();
    }
  }

  if (id === 'p-shield') {
    // THE RIM THE GAME ACTUALLY DRAWS AROUND THE MECH - still a field with a gap, not a closed
    // wall, but a much narrower gap than this used to have. At the old width (about a sixth of
    // the circle) the ring read as a stray letter C rather than as a shield; closing most of it
    // and studding what remains with a few energy nodes is what makes it read as an active field
    // instead of an open arc that happens to be blue.
    const GAP = 0.18;
    g.strokeStyle = KEY; g.lineWidth = 8;
    g.beginPath(); g.arc(CX, CY, 34, GAP, 6.284 - GAP); g.stroke();
    g.globalAlpha = 0.4; g.lineWidth = 15;
    g.beginPath(); g.arc(CX, CY, 34, GAP, 6.284 - GAP); g.stroke();
    g.globalAlpha = 1;
    // Energy nodes: bright diamonds set into the rim with a spark ticking outward from each, so
    // it reads as a charged field rather than a plain stroke that happens to have a seam in it.
    for (const ang of [1.6, 3.4, 5.0]) {
      const nx = CX + Math.cos(ang) * 34;
      const ny = CY + Math.sin(ang) * 34;
      g.strokeStyle = KEY;
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(nx, ny);
      g.lineTo(CX + Math.cos(ang) * 46, CY + Math.sin(ang) * 46);
      g.stroke();
      g.save();
      g.translate(nx, ny);
      g.rotate(ang);
      g.fillStyle = KEY;
      g.beginPath();
      g.moveTo(9, 0); g.lineTo(0, 6); g.lineTo(-9, 0); g.lineTo(0, -6);
      g.closePath();
      g.fill();
      g.restore();
    }
    g.beginPath(); g.arc(CX, CY, 12, 0, 6.284); g.fillStyle = STEEL; g.fill();
  }

  if (id === 'p-radiator') {
    // A HEATSINK WITH HEAT COMING OFF IT. Parallel fins are the one INERT gesture in this set -
    // every other glyph here points, pulses or grows - so the shimmer rising off the tallest fin
    // is the only thing that has to carry motion, the same way heat shimmer does over real metal.
    const FIN_W = 10, FIN_GAP = 6, FIN_BOT = CY + 34;
    const heights = [20, 28, 36, 28, 20];
    const total = heights.length * FIN_W + (heights.length - 1) * FIN_GAP;
    let fx = CX - total / 2;
    bar(fx - 4, FIN_BOT, total + 8, 7, STEEL);
    g.fillStyle = KEY;
    for (const h of heights) {
      bar(fx, FIN_BOT - h, FIN_W, h, KEY);
      fx += FIN_W + FIN_GAP;
    }
    g.strokeStyle = KEY;
    g.lineWidth = 3;
    g.lineCap = 'round';
    for (let i = 0; i < 2; i++) {
      const baseY = FIN_BOT - 44 - i * 13;
      g.globalAlpha = 0.75 - i * 0.3;
      g.beginPath();
      g.moveTo(CX - 15, baseY + 9);
      g.quadraticCurveTo(CX - 6, baseY - 7, CX, baseY);
      g.quadraticCurveTo(CX + 6, baseY + 7, CX + 15, baseY - 9);
      g.stroke();
    }
    g.globalAlpha = 1;
  }

  return c.toDataURL('image/png');
}`;

function resolveChromium() {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH ?? '/opt/pw-browsers';
  if (!existsSync(root)) return undefined;
  const candidates = [];
  for (const entry of readdirSync(root)) {
    if (entry.startsWith('chromium-')) candidates.push(join(root, entry, 'chrome-linux', 'chrome'));
  }
  for (const entry of readdirSync(root)) {
    if (entry.startsWith('chromium_headless_shell-')) {
      candidates.push(join(root, entry, 'chrome-linux', 'headless_shell'));
    }
  }
  return candidates.find((p) => existsSync(p));
}

async function main() {
  const { chromium } = await import('@playwright/test');
  const launchOptions = {};
  const found = resolveChromium();
  if (found !== undefined) launchOptions.executablePath = found;

  const browser = await chromium.launch(launchOptions);
  const page = await browser.newPage();
  await page.goto('about:blank');
  await mkdir(OUT_DIR, { recursive: true });

  let bytes = 0;
  for (const id of ICONS) {
    const dataUrl = await page.evaluate(`(${DRAW})(${JSON.stringify(id)})`);
    const buf = Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
    await writeFile(join(OUT_DIR, `icon_${id}.png`), buf);
    bytes += buf.length;
  }

  await browser.close();
  console.log(`${ICONS.length} icons, ${(bytes / 1024).toFixed(0)} kB -> ${OUT_DIR}`);
}

void main();
