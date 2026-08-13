/**
 * Headless harness. `npm run sim` plays a complete run in bare Node with a fixed seed and
 * prints a timeline.
 *
 * THIS IS THE PRIMARY BALANCE TOOL, not a debug script. It is the direct payoff of the pure-core
 * mandate: the whole game can be tuned from a phone, in a CI log, with no browser, no device and
 * no deploy. It is also purity enforcement layer 4 - a browser global that crept into src/core
 * throws here, immediately, with a stack trace.
 *
 * console and process are used freely: src/sim is OUTSIDE core.
 */

import {
  DT,
  EVENT_NAMES,
  EV_BOSS_SPAWNED,
  EV_LEVEL_UP,
  EV_PHASE_CHANGED,
  EV_UPGRADE_TAKEN,
  RUN_LENGTH_SEC,
  RUN_PHASE_DEAD,
  RUN_PHASE_NAMES,
  RUN_PHASE_VICTORY,
  Simulation,
  TICK_RATE,
  hashToHex,
  hashWorld,
  type World,
} from '../core/index.js';
import { botInput, createBot } from './botPolicy.js';

export interface HarnessOptions {
  seed: number;
  heroId: number;
  /** Simulated seconds to run. Defaults to the full run length plus the intro. */
  seconds: number;
  /** Seconds between timeline rows. */
  interval: number;
  /** Print the world hash on every timeline row - for eyeballing a determinism divergence. */
  hashes: boolean;
  quiet: boolean;
}

export const DEFAULT_OPTIONS: HarnessOptions = {
  seed: 0x5ca19a2d,
  heroId: 0,
  seconds: RUN_LENGTH_SEC + 8,
  interval: 30,
  hashes: false,
  quiet: false,
};

export function parseArgs(argv: readonly string[]): HarnessOptions {
  const o: HarnessOptions = { ...DEFAULT_OPTIONS };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const eq = a.indexOf('=');
    const key = eq >= 0 ? a.slice(0, eq) : a;
    const inlineValue = eq >= 0 ? a.slice(eq + 1) : undefined;
    const next = (): string => inlineValue ?? argv[++i] ?? '';
    switch (key) {
      case '--seed':
        o.seed = Number.parseInt(next(), 10) | 0;
        break;
      case '--hero':
      case '--heroId':
        o.heroId = Number.parseInt(next(), 10) | 0;
        break;
      case '--seconds':
        o.seconds = Number.parseFloat(next());
        break;
      case '--minutes':
        o.seconds = Number.parseFloat(next()) * 60;
        break;
      case '--interval':
        o.interval = Number.parseFloat(next());
        break;
      case '--hashes':
        o.hashes = true;
        break;
      case '--quiet':
        o.quiet = true;
        break;
      case '--help':
      case '-h':
        printUsage();
        break;
      default:
        break;
    }
  }
  return o;
}

function printUsage(): void {
  console.log(
    [
      'npm run sim -- [options]',
      '  --seed <int>       run seed (default 0x5ca19a2d)',
      '  --hero <0..7>      hero index into HERO_CATALOG',
      '  --minutes <n>      simulated minutes (default 15:08)',
      '  --interval <sec>   seconds between timeline rows (default 30)',
      '  --hashes           print the world hash on every row',
      '  --quiet            summary only',
    ].join('\n'),
  );
}

function clock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

function fixed(v: number, places: number): string {
  return Number.isFinite(v) ? v.toFixed(places) : '--';
}

function countLiveEnemies(world: World): number {
  return world.enemies.count;
}

/** Runs the sim and prints the timeline. Returns the finished world for further assertions. */
export function runHarness(options: HarnessOptions = DEFAULT_OPTIONS): World {
  const sim = new Simulation({ seed: options.seed, heroId: options.heroId });
  const world = sim.world;
  const bot = createBot();

  const hero = world.heroes[world.player.heroId];
  const weapon = world.weaponCount > 0 ? world.weaponCatalog[world.weapons[0].defId] : undefined;

  if (!options.quiet) {
    console.log('');
    console.log(`SCRAPYARD headless run`);
    console.log(
      `  seed ${options.seed} (0x${(options.seed >>> 0).toString(16)})   hero ${hero.name} [${hero.id}]   weapon ${weapon?.name ?? 'NONE'}`,
    );
    console.log(
      `  hp ${fixed(world.player.stats.maxHp, 0)}  speed ${fixed(world.player.stats.moveMaxSpeed, 1)} u/s  accel ${fixed(world.player.stats.moveAccel, 0)}  drag ${fixed(world.player.stats.moveDrag, 3)} (derived)`,
    );
    if (weapon !== undefined) {
      const ws = world.weapons[0].stats;
      console.log(
        `  cannon dmg ${fixed(ws.damage, 1)}  cd ${fixed(ws.cooldown, 2)}s  range ${fixed(ws.range, 0)}  shell ${fixed(ws.projectileSpeed, 0)} u/s  splash ${fixed(ws.splashRadius, 0)}@${fixed(ws.splashFrac, 2)}`,
      );
    }
    console.log('');
    console.log(
      '  time   lvl  xp        dps    kills  live  cyc  press/tgt   proj gems   hp        ' +
        (options.hashes ? 'hash' : ''),
    );
  }

  const totalTicks = Math.round(options.seconds * TICK_RATE);
  const rowTicks = Math.max(1, Math.round(options.interval * TICK_RATE));

  let lastDamage = 0;
  let lastRowTick = 0;
  let firstLevelTick = -1;
  const levelTimes: number[] = [];

  for (let t = 0; t < totalTicks; t++) {
    sim.step(botInput(bot, world));

    // Drain the event ring exactly as the renderer would - the harness is one of the three
    // sanctioned consumers of readCursor.
    drainEvents(world, options.quiet, (kind, tick) => {
      if (kind === EV_LEVEL_UP) {
        if (firstLevelTick < 0) firstLevelTick = tick;
        levelTimes.push(tick);
      }
    });

    // Rows are keyed off runTicks, not tick, so they land on clean clock times (00:30, 01:00,
    // ...) rather than being offset by the 3 s intro.
    if (world.runTicks - lastRowTick >= rowTicks && !options.quiet) {
      const elapsed = (world.runTicks - lastRowTick) * DT;
      const dps = (world.stats.damageDealt - lastDamage) / elapsed;
      lastDamage = world.stats.damageDealt;
      lastRowTick = world.runTicks;
      printRow(world, dps, options.hashes);
    }

    if (world.phase === RUN_PHASE_DEAD || world.phase === RUN_PHASE_VICTORY) break;
  }

  printSummary(world, options, firstLevelTick, levelTimes);
  return world;
}

function printRow(world: World, dps: number, withHash: boolean): void {
  const p = world.player;
  const d = world.director;
  const row = [
    `[${clock(world.runSec)}]`,
    String(p.level).padStart(3),
    `${String(Math.floor(p.xp)).padStart(4)}/${String(Math.floor(p.xpToNext)).padEnd(4)}`,
    fixed(dps, 1).padStart(7),
    String(world.stats.kills).padStart(6),
    String(countLiveEnemies(world)).padStart(5),
    `${String(d.cycleIndex)}.${String(d.cyclePhase)}`.padStart(4),
    `${fixed(d.localPressure, 0).padStart(4)}/${fixed(d.targetPressure, 0).padEnd(4)}`,
    String(world.projectiles.count).padStart(5),
    String(world.pickups.count).padStart(4),
    `${fixed(p.hp, 0).padStart(4)}/${fixed(p.stats.maxHp, 0).padEnd(4)}`,
    withHash ? hashToHex(hashWorld(world)) : '',
  ];
  console.log('  ' + row.join('  '));
}

/**
 * Consumes the event ring, printing the handful of events that are worth a line of a 15-minute
 * timeline. Everything else is counted by RunStats.
 */
function drainEvents(
  world: World,
  quiet: boolean,
  onEvent: (kind: number, tick: number) => void,
): void {
  const r = world.events;
  while (r.readCursor < r.writeCursor) {
    const i = r.readCursor & r.mask;
    const kind = r.kind[i];
    const tick = r.tick[i];
    onEvent(kind, tick);

    if (!quiet) {
      if (kind === EV_BOSS_SPAWNED) {
        console.log(`  [${clock(world.runSec)}]  ** BOSS ** ${world.director.cycle.name} hp=${fixed(r.d[i], 0)}`);
      } else if (kind === EV_PHASE_CHANGED) {
        const phase = RUN_PHASE_NAMES[r.a[i]] ?? String(r.a[i]);
        if (phase === 'DEAD' || phase === 'VICTORY' || phase === 'RUNNING') {
          console.log(`  [${clock(world.runSec)}]  -- ${phase} --`);
        }
      } else if (kind === EV_UPGRADE_TAKEN) {
        // Field `a` is the catalog index; `c` is picksTaken. Reading `c` here printed whichever
        // upgrade happened to sit at "number of picks so far", so every name in every timeline
        // this harness has ever produced was wrong - and wrong in a plausible-looking way.
        // Field `a` is the catalog index, `b` is the new stack count - which for a weapon card IS
        // its tier. Printing the player level instead made a four-card pool read as a wall of
        // repeated names with no indication of what had actually improved.
        const def = world.upgradeCatalog[r.a[i]];
        const tier = r.b[i];
        console.log(
          `  [${clock(world.runSec)}]  + ${def?.name ?? `upgrade ${r.a[i]}`} T${tier}`,
        );
      }
    }
    r.readCursor++;
  }
  if (r.dropped > 0 && !quiet) {
    console.log(`  (event ring dropped ${r.dropped} events - consumer fell behind)`);
    r.dropped = 0;
  }
}

function printSummary(
  world: World,
  options: HarnessOptions,
  firstLevelTick: number,
  levelTimes: readonly number[],
): void {
  const s = world.stats;
  const p = world.player;
  const outcome =
    world.phase === RUN_PHASE_VICTORY
      ? 'VICTORY'
      : world.phase === RUN_PHASE_DEAD
        ? 'DEAD'
        : 'TIME UP';

  console.log('');
  console.log(`  ---- ${outcome} at ${clock(world.runSec)} (tick ${world.tick}) ----`);
  console.log(`  level             ${p.level}   (${world.levelUp.picksTaken} upgrades taken)`);
  console.log(
    `  first level-up    ${firstLevelTick >= 0 ? `tick ${firstLevelTick} (${clock(firstLevelTick * DT)})` : 'never'}`,
  );
  console.log(
    `  kills             ${s.kills}  [regular ${s.killsByRank[0]}, elite ${s.killsByRank[1]}, boss ${s.killsByRank[2]}]`,
  );
  console.log(
    `  damage            dealt ${fixed(s.damageDealt, 0)}   taken ${fixed(s.damageTaken, 0)}`,
  );
  console.log(
    `  shots             ${s.shotsFired} fired, ${s.shotsHit} hit (${fixed(s.shotsFired > 0 ? (100 * s.shotsHit) / s.shotsFired : 0, 1)}%)`,
  );
  console.log(`  gems              ${s.gemsCollected}`);
  console.log(`  peak enemies      ${s.peakEnemies}`);
  console.log(`  level timeline    ${levelTimes.map((t) => clock(t * DT)).join(' ') || '-'}`);
  console.log(`  final hash        ${hashToHex(hashWorld(world))}`);
  console.log(`  seed              ${options.seed} / hero ${options.heroId}`);
  console.log('');
}

export function main(argv: readonly string[]): void {
  const options = parseArgs(argv);
  runHarness(options);
}

/** Named export used by the events summary above; kept for tooling that wants event labels. */
export { EVENT_NAMES };
