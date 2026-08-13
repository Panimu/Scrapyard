/**
 * The renderer. Reads World, draws it, owns no rules.
 *
 * THE CONTRACT (DESIGN.md §10): nothing in this file writes to World. Not a position, not a
 * timer, not a flag. The simulation is stepped by main.ts and everything here is a pure read of
 * the result, which is what lets `npm run sim` reproduce a phone session byte for byte in Node.
 *
 * INTERPOLATION uses the pools' own `prevX/prevY`. That is not an optimisation, it is the only
 * correct source: the pools swap-remove on reap, so dense index 47 is a different enemy after a
 * kill. A renderer caching last-frame positions in its own array keyed by dense index would
 * interpolate enemy A's new position from enemy B's old one - a one-frame teleport streak on
 * every kill (see the comment on EnemyPool.prevX).
 *
 * LAYER ORDER, and why: floor -> pickups -> enemies (y-sorted) -> HP bars -> player ->
 * projectiles -> normal FX -> additive FX. Additive last because a blend-mode change always
 * flushes the batch, so we pay for exactly one.
 *
 * BEAMS live inside that trailing additive run - above the enemies and the player (a laser is in
 * front of the thing it is burning), below the DOM HUD (which is a separate compositing layer and
 * is always on top). They are additive themselves, so putting them anywhere else would cost a
 * second blend-state flush for nothing. Their one NORMAL-blended under-layer (the dark sheath
 * that keeps a saturated beam readable on a rust floor) is parked at the tail of the normal run
 * instead, so the frame still pays exactly two blend-state changes.
 */

import { Application, Container, Graphics, Sprite, Texture, TilingSprite } from 'pixi.js';
import {
  ARCHETYPES,
  BOSS_OUTLINE_SCALE,
  BOSS_OUTLINE_TINT,
  ENEMY_FLAG_BOSS,
  ENEMY_FLAG_ELITE,
  EV_BOSS_SPAWNED,
  EV_ENEMY_DAMAGED,
  EV_ENEMY_KILLED,
  EV_GEM_COLLECTED,
  EV_LEVEL_UP,
  EV_PLAYER_DAMAGED,
  EV_PLAYER_SHIELD_BROKEN,
  EV_PLAYER_SHIELD_RESTORED,
  EV_PROJECTILE_DETONATED,
  EV_PROJECTILE_HIT,
  EV_WEAPON_FIRED,
  FLAVOURS,
  RANKS,
  RANK_BOSS,
  RANK_ELITE,
  RANK_REGULAR,
  VIS_MISSILE_LONG,
  VIS_MISSILE_SHORT,
  VIS_SLUG,
  VIS_STRIKE_MARKER,
  type World,
} from '../core/index.js';
import { BeamLayer } from './beams.js';
import { Camera } from './camera.js';
import { Effects } from './effects.js';
import { SpritePool } from './spritePool.js';
import {
  GEM_SCALE,
  GEM_TINT,
  MECH_SCALE,
  PARTICLE_SRC,
  ROT_OFFSET,
  SLUG_SCALE,
  MECH_WALK_FRAMES,
  MISSILE_LONG_SCALE_X,
  MISSILE_LONG_SCALE_Y,
  MISSILE_SHORT_SCALE_X,
  MISSILE_SHORT_SCALE_Y,
  SHELL_SCALE,
  TURRET_SCALE,
  type GameTextures,
} from './assets.js';

/**
 * `EV_ENEMY_KILLED` carries the reason in `d`. 1 means the enemy walked past DESPAWN_RADIUS and
 * was recycled - no death, no puff. Mirrored from src/core/systems/enemyAI.ts, which is not part
 * of the public barrel, so it cannot be imported; the value is part of the event contract.
 */
const KILL_REASON_DESPAWNED = 1;

/** Pool capacities. Sized against the core's caps, not guessed. */
const ENEMY_SPRITES = 320; // MAX_LIVE_ENEMIES is 300
const PICKUP_SPRITES = 420; // GEM_SOFT_CAP is 400
const PROJECTILE_SPRITES = 256; // PROJECTILE_CAP
const HP_BAR_SPRITES = 128; // 64 bars x (track + fill)
const GLOW_SPRITES = 96;

/** Health bar geometry, world units. */
const HP_BAR_W_FRAC = 0.9;
const HP_BAR_H = 4;
const HP_BAR_GAP = 8;

/** Player hit feedback, seconds. */
const PLAYER_FLASH_SEC = 0.12;
/** Level-up heal feedback, seconds. Longer than a hit flash - it is good news, not a warning. */
const HEAL_FLASH_SEC = 0.45;

/**
 * World units walked per leg-frame. Eight frames make a full cycle, so a stride is 8 x this =
 * 184 u, against a 195 u/s mech: a little over one cycle a second at a flat run. FEEL.
 */
const STRIDE_UNITS = 23;
/** Peak chassis yaw across a gait cycle, radians. Deliberately small - weight shift, not a waddle. */
const GAIT_YAW = 0.045;
/** A hover's idle drift through its own cycle, in equivalent world units per second. */
const HOVER_IDLE_SPEED = 34;
/** Turret recoil: how far the mount slides back along its axis, and for how long. */
const TURRET_KICK_UNITS = 5;
const TURRET_KICK_SEC = 0.08;

/**
 * ENERGY SHIELD RIMS.
 *
 * One Graphics holding every rim rather than one per layer: the ring is redrawn only when the
 * layer count actually changes, and the whole shield - one rim or two - is a single draw call
 * sitting inside the player layer.
 *
 * Radii are measured from the 26 u collision circle outward. The first rim sits just outside the
 * drawn hull; the second is far enough out to be countable at a glance on a phone, which is the
 * only thing the second rim has to communicate.
 */
const SHIELD_RIM_RADIUS = 38;
const SHIELD_RIM_STEP = 7;
const SHIELD_RIM_WIDTH = 2.5;
const SHIELD_RIM_TINT = 0x4fa8ff;
/**
 * The rim breathes between these two alphas. A static ring reads as part of the chassis art; a
 * moving one reads as a field that is running, which is the difference between the player noticing
 * it is gone and not.
 */
const SHIELD_ALPHA_MIN = 0.45;
const SHIELD_ALPHA_MAX = 0.8;
/** Breaths per second. Slow: this is ambient state, not an alarm. */
const SHIELD_PULSE_HZ = 0.7;

/**
 * ARTILLERY STRIKE MARKERS.
 *
 * The artillery does not fire a shell at anything - three rounds arrive on ground near the mech
 * after a 0.7 s fuse, and the fuse IS the weapon: it is the time the player has to read the ground
 * and decide whether to walk into it. So the projectile is not drawn as a projectile at all. It is
 * a red targeting ring lying on the floor, exactly the size of the blast that is coming, with a
 * second ring closing inward as the fuse burns down.
 *
 * Sizing it from the projectile's own `splashRadius` rather than from a constant is what makes the
 * marker honest: the circle you are looking at is the circle that will be damaged, and it grows by
 * itself as the weapon tiers up from 75 u to 111 u.
 *
 * It is drawn BENEATH everything in the world - under the gems, under the horde, under the mech -
 * because it is paint on the ground. A marker over the top of the crowd would hide the bodies the
 * player is trying to decide about.
 */
const STRIKE_TINT = 0xff3b30;
const STRIKE_RING_WIDTH = 2;
const STRIKE_FILL_ALPHA = 0.1;
const STRIKE_RING_ALPHA = 0.75;
/** Length of the four crosshair ticks, as a fraction of the blast radius. */
const STRIKE_TICK_FRAC = 0.22;
/** The closing ring stops here rather than at zero - a dot that vanishes reads as a glitch. */
const STRIKE_MIN_FRAC = 0.12;

export interface RenderStats {
  enemySprites: number;
  pickupSprites: number;
  projectileSprites: number;
  effects: number;
  /** Beams drawn on the last frame. 0..MAX_WEAPONS. */
  beams: number;
}

export class GameRenderer {
  readonly camera = new Camera();
  readonly stats: RenderStats = {
    enemySprites: 0,
    pickupSprites: 0,
    projectileSprites: 0,
    effects: 0,
    beams: 0,
  };

  private readonly floor: TilingSprite;
  private readonly world: Container;
  private readonly letterbox: Graphics;

  private readonly pickups: SpritePool;
  private readonly enemies: SpritePool;
  private readonly hpBars: SpritePool;
  private readonly playerLayer: Container;
  private readonly barrel: Sprite;
  private readonly mech: Sprite;
  private readonly legs: Sprite;
  private readonly shieldRim: Graphics;
  /** Layer count currently DRAWN into `shieldRim`. -1 forces a redraw on the first frame. */
  private shieldRimDrawn = -1;
  /**
   * Artillery markers, all of them in ONE Graphics. Unlike the shield rim this genuinely is
   * redrawn every frame - the closing ring is an animation - but there are at most four markers
   * on screen at once (a tier-7 barrage), and one Graphics is one draw call however many circles
   * are inside it.
   */
  private readonly strikeMarkers: Graphics;
  private readonly trails: SpritePool;
  private readonly projectiles: SpritePool;
  private readonly glows: SpritePool;
  private readonly beams: BeamLayer;
  private readonly effects: Effects;

  /** Wall-clock seconds since boot, for cosmetic cycles (gem bob). Never touches the sim. */
  private clock = 0;
  private playerFlash = 0;
  /**
   * Green tint while the level-up heal lands. The health bar moves too, but the card opens over
   * it the same instant - so without a cue on the mech itself the only healing in the game
   * happens entirely behind a menu.
   */
  private healFlash = 0;
  /**
   * GAIT PHASE, IN WORLD UNITS WALKED - not seconds.
   *
   * Driving the walk cycle off distance rather than the clock is the whole difference between a
   * mech that walks and a mech that moon-walks: stand still and the legs stop mid-stride, sprint
   * and they keep up, and the feet never slide against ground they are not covering. It also
   * makes the cycle immune to frame rate, which a per-frame counter would not be.
   */
  private stride = 0;
  private prevPlayerX = Number.NaN;
  private prevPlayerY = Number.NaN;
  /** Seconds left of the turret's recoil kick. Cosmetic; the shell has already left. */
  private turretKick = 0;

  constructor(
    private readonly app: Application,
    private readonly tex: GameTextures,
  ) {
    this.floor = new TilingSprite({ texture: tex.floor, width: 1, height: 1, label: 'floor' });

    // isRenderGroup: camera movement becomes one GPU-side transform instead of re-walking every
    // child's world transform each frame.
    this.world = new Container({ isRenderGroup: true, label: 'world' });

    this.pickups = new SpritePool({ capacity: PICKUP_SPRITES, texture: tex.gem, label: 'pickups' });
    this.enemies = new SpritePool({
      capacity: ENEMY_SPRITES,
      sortable: true, // y-sorted for depth; zIndex is rewritten every frame
      label: 'enemies',
    });
    this.hpBars = new SpritePool({
      capacity: HP_BAR_SPRITES,
      texture: Texture.WHITE,
      label: 'hp-bars',
    });

    this.playerLayer = new Container({ label: 'player' });
    this.barrel = new Sprite({ texture: tex.turret, roundPixels: true });
    // Pivot on the mount ring rather than the sprite centre: the turret swings about a point just
    // behind the mech's middle, so the barrels sweep across the hull the way a real mount would.
    this.barrel.anchor.set(0.2, 0.5);
    this.barrel.scale.set(TURRET_SCALE);
    this.mech = new Sprite({ texture: tex.mechs[0], roundPixels: true });
    this.mech.anchor.set(0.5, 0.5);
    this.mech.scale.set(MECH_SCALE);
    // The leg layer carries the walk cycle AND the ground shadow, so it goes under everything.
    // Same canvas size and same anchor as the body, so the two register exactly whatever the
    // chassis - no per-hero offset table to drift out of date.
    this.legs = new Sprite({ texture: tex.mechLegs[0][0], roundPixels: true });
    this.legs.anchor.set(0.5, 0.5);
    this.legs.scale.set(MECH_SCALE);
    // The rim goes ABOVE the turret so it is never half-hidden behind a barrel swinging through
    // it. It is a field around the whole machine, and a field that the gun occludes reads as a
    // decal painted on the floor.
    this.shieldRim = new Graphics({ label: 'shield-rim' });
    // Turret ON TOP of the chassis: the mech walks one way and shoots another, and the turret is
    // the only thing on screen that says where the shot is going before it arrives.
    this.playerLayer.addChild(this.legs, this.mech, this.barrel, this.shieldRim);

    this.trails = new SpritePool({
      capacity: PROJECTILE_SPRITES,
      texture: tex.fxTrail,
      anchorY: 0,
      blendMode: 'add',
      label: 'trails',
    });
    this.projectiles = new SpritePool({
      capacity: PROJECTILE_SPRITES,
      texture: tex.shell,
      label: 'shells',
    });
    this.glows = new SpritePool({
      capacity: GLOW_SPRITES,
      texture: tex.fxFlash,
      blendMode: 'add',
      label: 'glows',
    });
    // Effects first: the beam layer spawns impact debris, burn marks and the overheat sputter
    // through it, so it holds the reference for the life of the renderer.
    this.effects = new Effects(tex);
    this.beams = new BeamLayer(tex, this.effects);

    this.letterbox = new Graphics({ label: 'letterbox' });
    this.strikeMarkers = new Graphics({ label: 'strike-markers' });

    this.world.addChild(
      // FIRST, so it is under every other thing in the world. It is paint on the floor, and a
      // marker drawn over the crowd would hide the bodies the player is deciding about.
      this.strikeMarkers,
      this.pickups.container,
      this.enemies.container,
      this.hpBars.container,
      this.playerLayer,
      this.projectiles.container,
      this.effects.normalPool.container,
      // The beams' dark sheath is NORMAL blended, so it goes here, at the tail of the normal
      // run, rather than inside the beam layer proper. Putting it with the rest of the beam
      // would sandwich a normal draw inside the additive run and cost two extra state flips.
      this.beams.underContainer,
      // Everything additive, adjacent and last: one blend-state change for the whole frame.
      this.trails.container,
      this.glows.container,
      this.effects.addPool.container,
      // The beam layer goes after them because its own halo is additive too - it extends that
      // single run - and only its opaque cores flip the blend state back, once, at the very end.
      this.beams.container,
    );

    this.app.stage.addChild(this.floor, this.world, this.letterbox);
  }

  /** CSS px. Called from the debounced visualViewport handler, never from the draw path. */
  resize(w: number, h: number): void {
    this.camera.resize(w, h);
    this.floor.width = w;
    this.floor.height = h;
    this.drawLetterbox();
  }

  /** Wipes every transient sprite and effect. Called when a run starts or is abandoned. */
  reset(world: World): void {
    this.pickups.clear();
    this.enemies.clear();
    this.hpBars.clear();
    this.trails.clear();
    this.projectiles.clear();
    this.glows.clear();
    this.beams.clear();
    this.effects.clear();
    this.playerFlash = 0;
    // -1, not 0: the new run may start with the same layer count the last one ended on, and a
    // cleared Graphics that believes it is already drawn would leave the rim missing all run.
    this.shieldRimDrawn = -1;
    this.shieldRim.clear();
    this.strikeMarkers.clear();
    this.mech.texture = this.tex.mechs[world.player.heroId] ?? this.tex.mechs[0];
    this.camera.snapTo(world.player.x, world.player.y);
    // Drop anything the previous run left in the ring so its explosions do not play now.
    world.events.readCursor = world.events.writeCursor;
  }

  /**
   * One rendered frame.
   *
   * @param alpha sub-tick interpolation factor in [0, 1) - `Simulation.alpha`
   * @param dtSec real seconds since the previous rendered frame, for cosmetic timers only
   */
  draw(world: World, alpha: number, dtSec: number): void {
    this.clock += dtSec;
    if (this.playerFlash > 0) this.playerFlash -= dtSec;
    if (this.healFlash > 0) this.healFlash -= dtSec;
    if (this.turretKick > 0) this.turretKick -= dtSec;

    this.drainEvents(world);
    this.effects.update(dtSec);
    this.camera.update(dtSec);

    const px = lerp(world.player.prevX, world.player.x, alpha);
    const py = lerp(world.player.prevY, world.player.y, alpha);
    this.camera.follow(px, py);

    this.drawFloor();
    this.drawPickups(world, alpha);
    this.drawEnemies(world, alpha);
    this.drawPlayer(world, px, py, dtSec);
    this.drawProjectiles(world, alpha);
    // NOT interpolated, unlike everything above it: the endpoints are the ones the simulation
    // published this tick, so the line and the damage can never disagree. `dtSec` drives the
    // render-only fire/fade envelope; `px, py` only place the emitter's heat glow on a weapon
    // that is NOT firing and therefore has no published muzzle to sit on.
    this.beams.draw(world, this.clock, dtSec, px, py);
    this.effects.draw();

    this.world.position.set(this.camera.originX, this.camera.originY);
    this.world.scale.set(this.camera.scale);

    this.stats.enemySprites = this.enemies.inUse;
    this.stats.pickupSprites = this.pickups.inUse;
    this.stats.projectileSprites = this.projectiles.inUse;
    this.stats.effects = this.effects.liveCount;
    this.stats.beams = this.beams.liveCount;

    this.app.render();
  }

  // -------------------------------------------------------------------------------------------
  // Events
  // -------------------------------------------------------------------------------------------

  /**
   * Drains the event ring into cosmetic effects.
   *
   * The ring survives across the up-to-five sim steps a single frame may run, which is exactly
   * why it is a ring with a read cursor and not a per-tick buffer - a frame that ran five steps
   * must still see step one's muzzle flash.
   */
  private drainEvents(world: World): void {
    const r = world.events;
    const px = world.player.x;
    const py = world.player.y;

    while (r.readCursor !== r.writeCursor) {
      const i = r.readCursor++ & r.mask;
      const a = r.a[i];
      const b = r.b[i];
      const c = r.c[i];
      const d = r.d[i];

      switch (r.kind[i]) {
        case EV_LEVEL_UP:
          this.healFlash = HEAL_FLASH_SEC;
          break;

        case EV_WEAPON_FIRED:
          // Payload is muzzle position then the shell's unit direction - everything needed to
          // place and rotate the flash without recomputing anything.
          this.effects.muzzle(a, b, c, d);
          this.turretKick = TURRET_KICK_SEC;
          this.camera.kick(c, d);
          break;

        case EV_ENEMY_DAMAGED:
          this.effects.spark(a, b);
          break;

        case EV_PROJECTILE_HIT:
          this.effects.impact(a, b);
          break;

        // A fused shell blew up in open air - today, always an artillery round landing. `c` is the
        // blast RADIUS, so the crater drawn is the ground actually damaged and matches the ring
        // the marker was showing a moment before.
        case EV_PROJECTILE_DETONATED:
          if (c > 0) this.effects.artilleryBlast(a, b, c);
          else this.effects.impact(a, b);
          break;

        case EV_ENEMY_KILLED:
          if (d !== KILL_REASON_DESPAWNED) this.effects.puff(a, b, 32);
          break;

        case EV_PLAYER_DAMAGED:
          this.playerFlash = PLAYER_FLASH_SEC;
          break;

        // A rim went down. Blue burst, and DELIBERATELY NO `playerFlash` - the red hit tint means
        // "that cost you HP", and firing it here would teach the player to read a blocked hit as
        // a taken one, which is the exact opposite of what the shield is telling them.
        case EV_PLAYER_SHIELD_BROKEN:
          this.effects.shieldBreak(a, b, SHIELD_RIM_TINT);
          break;

        case EV_PLAYER_SHIELD_RESTORED:
          this.effects.shieldRestore(a, b, SHIELD_RIM_TINT);
          break;

        case EV_GEM_COLLECTED: {
          // Defensive: gem collection happens at the player, so a payload that is not a position
          // would otherwise scatter sparkles at the arena origin.
          const dx = a - px;
          const dy = b - py;
          if (dx * dx + dy * dy < 250 * 250) this.effects.sparkle(a, b, GEM_TINT[0]);
          break;
        }

        case EV_BOSS_SPAWNED:
          this.effects.impact(a, b, 3);
          break;

        default:
          break;
      }
    }
  }

  // -------------------------------------------------------------------------------------------
  // Layers
  // -------------------------------------------------------------------------------------------

  private drawLetterbox(): void {
    const { viewW, viewH, barX, barY } = this.camera;
    const g = this.letterbox;
    g.clear();
    if (barY > 0) {
      g.rect(0, 0, viewW, barY).rect(0, viewH - barY, viewW, barY).fill({ color: 0x000000 });
    }
    if (barX > 0) {
      g.rect(0, 0, barX, viewH).rect(viewW - barX, 0, barX, viewH).fill({ color: 0x000000 });
    }
  }

  /**
   * The floor is a screen-space TilingSprite, so scrolling it is two uniform writes rather than
   * hundreds of tile sprites. The texture wraps with REPEAT, which is why it must stay out of
   * any atlas - a sub-rect cannot wrap.
   *
   * `tileScale = camera.scale` makes the 64 px tile cover exactly FLOOR_TILE_UNITS world units,
   * and `tilePosition = camera origin` puts world (0, 0) on a tile corner, so the ground scrolls
   * with the camera at exactly the right rate.
   */
  private drawFloor(): void {
    this.floor.tileScale.set(this.camera.scale);
    this.floor.tilePosition.set(this.camera.originX, this.camera.originY);
  }

  private drawPickups(world: World, alpha: number): void {
    const p = world.pickups;
    const pool = this.pickups;
    pool.begin();

    for (let d = 0; d < p.count; d++) {
      const x = lerp(p.prevX[d], p.x[d], alpha);
      const y = lerp(p.prevY[d], p.y[d], alpha);
      if (!this.camera.isVisible(x, y, 12)) continue;

      const s = pool.acquire();
      if (s === undefined) break;

      // Bob phase keyed off spawnId so each gem has its own rhythm and none of them pulse in
      // lockstep. spawnId is stable across the pool's swap-removes; the dense index is not.
      const phase = p.spawnId[d] * 0.7;
      s.position.set(x, y + Math.sin(this.clock * 3 + phase) * 2.5);
      s.rotation = Math.sin(this.clock * 1.6 + phase) * 0.35;
      s.scale.set(GEM_SCALE);
      s.tint = GEM_TINT[p.tier[d]] ?? GEM_TINT[0];
      s.alpha = 1;
    }

    pool.end();
  }

  private drawEnemies(world: World, alpha: number): void {
    const p = world.enemies;
    const pool = this.enemies;
    const bars = this.hpBars;
    const glows = this.glows;
    const tex = this.tex;

    pool.begin();
    bars.begin();
    glows.begin();

    for (let d = 0; d < p.count; d++) {
      const x = lerp(p.prevX[d], p.x[d], alpha);
      const y = lerp(p.prevY[d], p.y[d], alpha);
      const radius = p.radius[d];
      if (!this.camera.isVisible(x, y, radius)) continue;

      const typeId = p.typeId[d];
      const flags = p.flags[d];
      const isBoss = (flags & ENEMY_FLAG_BOSS) !== 0;
      const isElite = (flags & ENEMY_FLAG_ELITE) !== 0;
      const flavour = FLAVOURS[p.flavourId[d]];
      const texture = tex.enemies[typeId] ?? tex.enemies[0];

      // RANK IS A DRAW SIZE, NOT A SPRITE. Elite and boss are recolours of the SAME hull the
      // regular uses (content/cycles.ts), so there is no boss texture and no boss scale table -
      // the atlas frame's own scale, times the rank multiplier the sim already applied to the
      // collision radius. The thing you see is exactly the thing you can hit.
      const rank = isBoss ? RANK_BOSS : isElite ? RANK_ELITE : RANK_REGULAR;
      const base = tex.enemyScale[typeId] * RANKS[rank].size * (flavour?.renderScale ?? 1);

      // THE BOSS OUTLINE. A second, larger, blue copy of the same sprite parked one z below the
      // body - the sprite has an alpha silhouette, so scaling it 14% and tinting it reads as a
      // rim rather than as a shadow. It costs one quad out of the SAME pool and the SAME texture
      // as the body, so it batches with every other enemy in the frame and adds no draw call.
      if (isBoss) {
        const o = pool.acquire();
        if (o === undefined) break;
        const ob = base * BOSS_OUTLINE_SCALE;
        o.texture = texture;
        o.rotation = 0;
        o.scale.set(p.vx[d] < 0 ? -ob : ob, ob);
        o.position.set(x, y);
        o.zIndex = y - 1;
        o.tint = BOSS_OUTLINE_TINT;
        o.alpha = 0.95;
      }

      const s = pool.acquire();
      if (s === undefined) break;

      s.texture = texture;

      // NEVER rotated. These are fixed 3/4-view RTS sprites with baked drop shadows and mutually
      // inconsistent headings; rotating them makes trucks drive on their side and swings the
      // shadow around. Horizontal flip only (ASSET_MANIFEST §2).
      s.rotation = 0;
      s.scale.set(p.vx[d] < 0 ? -base : base, base);
      s.position.set(x, y);
      s.zIndex = y;
      s.tint = 0xffffff;
      s.alpha = 1;

      // `spiky` carries +35% contact damage and NO extra HP, so the targeting rule ignores it -
      // this additive rim is the only cue the player gets. It uses the same soft-flash texture as
      // the impact FX so it batches with them instead of adding a texture bind.
      //
      // THE BOSS DELIBERATELY GETS NO GLOW. An additive blue over the rust floor resolves to
      // white, which reads as a hit flash and drowns the outline that is supposed to be the cue.
      // The silhouette pass above is the whole tell, and it stays blue because it is a normal
      // tinted sprite rather than an additive one.
      if (!isBoss && flavour?.renderGlow === true) {
        const g = glows.acquire();
        if (g !== undefined) {
          g.position.set(x, y);
          g.scale.set((radius * 3.4) / PARTICLE_SRC);
          g.tint = 0xff4030;
          g.alpha = 0.32;
          g.rotation = 0;
        }
      }

      // RANK DECIDES THE BAR, AND NOTHING ELSE DOES. Elites and bosses always carry one; a
      // regular never does, whatever chassis it happens to be built on.
      //
      // The chassis used to get a vote (`ArchetypeDef.showHpBar`), which produced the exact
      // inconsistency the rule now forbids: a 125 HP Breaker regular showed a bar because its
      // body class is a bruiser, while a 160 HP Warden regular did not because its body class is
      // a grunt. A bar has to mean "this one is a rank above you", not "this one happens to be
      // drawn on a wide hull".
      const arch = ARCHETYPES[p.archetype[d]];
      if ((isBoss || isElite) && p.hp[d] < p.maxHp[d]) {
        this.drawHpBar(bars, x, y, radius, (arch?.drawSize ?? 32) * RANKS[rank].size, p.hp[d] / p.maxHp[d]);
      }
    }

    pool.end();
    bars.end();
    glows.end();
  }

  /**
   * Two Texture.WHITE quads. Deliberately NOT `Graphics`: a Graphics bar drawn between two enemy
   * sprites starts a new batch for every enemy after it. Sharing one white texture across every
   * bar in the game keeps the whole HP-bar layer in a single draw call.
   */
  private drawHpBar(
    bars: SpritePool,
    x: number,
    y: number,
    radius: number,
    drawSize: number,
    frac: number,
  ): void {
    const w = drawSize * HP_BAR_W_FRAC;
    const top = y - radius - HP_BAR_GAP;

    const track = bars.acquire();
    if (track === undefined) return;
    track.position.set(x, top);
    track.scale.set(w, HP_BAR_H);
    track.tint = 0x1b2028;
    track.alpha = 0.85;

    const fill = bars.acquire();
    if (fill === undefined) return;
    const fw = w * Math.max(0, Math.min(1, frac));
    // Anchor stays centred, so shrink the quad and shift it left by half the loss.
    fill.position.set(x - (w - fw) * 0.5, top);
    fill.scale.set(fw, HP_BAR_H - 1.5);
    fill.tint = frac > 0.5 ? 0x8bd450 : frac > 0.22 ? 0xe7b900 : 0xd7503f;
    fill.alpha = 1;
  }

  private drawPlayer(world: World, px: number, py: number, dtSec: number): void {
    const pl = world.player;
    const hero = world.heroes[pl.heroId];

    // --- gait phase ------------------------------------------------------------------------
    // Advance by DISTANCE WALKED. A hover also idles on the clock, because a hover that goes
    // completely still has landed; a walker deliberately does not, so standing still parks the
    // legs mid-stride instead of moon-walking on the spot.
    if (Number.isFinite(this.prevPlayerX)) {
      const dx = px - this.prevPlayerX;
      const dy = py - this.prevPlayerY;
      this.stride += Math.sqrt(dx * dx + dy * dy);
    }
    if (hero?.gait === 'hover') this.stride += HOVER_IDLE_SPEED * dtSec;
    this.prevPlayerX = px;
    this.prevPlayerY = py;

    // Eight poses out of four textures: the second half of the cycle is the first half with the
    // legs exchanged, and exchanging the legs on a chassis mirrored about its own centreline is
    // exactly a vertical flip. See GameTextures.mechLegs.
    const cycleSteps = MECH_WALK_FRAMES * 2;
    const step = Math.floor(this.stride / STRIDE_UNITS) % cycleSteps;
    const frames = this.tex.mechLegs[pl.heroId] ?? this.tex.mechLegs[0];
    this.legs.texture = frames[step % MECH_WALK_FRAMES] ?? frames[0];
    const flip = step >= MECH_WALK_FRAMES ? -1 : 1;

    // A walker shifts its weight onto the planted foot, so the whole machine yaws a little
    // against the swing. Small - a few degrees - but it is what stops the chassis reading as a
    // sprite being slid across the floor by something off-screen.
    const facing = Math.atan2(pl.faceY, pl.faceX) + ROT_OFFSET.mech;
    const phase = (this.stride / (STRIDE_UNITS * cycleSteps)) * Math.PI * 2;
    const yaw = hero?.gait === 'hover' ? 0 : Math.sin(phase) * GAIT_YAW;
    // Damage wins over the heal: being hit is the more urgent fact.
    const tint = this.playerFlash > 0 ? 0xffb0a8 : this.healFlash > 0 ? 0xb6f5c4 : 0xffffff;

    this.legs.position.set(px, py);
    this.legs.rotation = facing + yaw;
    this.legs.scale.set(MECH_SCALE, MECH_SCALE * flip);
    this.legs.tint = tint;

    // The chassis faces velocity; the turret is independent and driven by the weapon instance,
    // which is what makes the mech read as "walking one way, shooting another".
    this.mech.position.set(px, py);
    this.mech.rotation = facing + yaw;
    this.mech.tint = tint;

    // --- turret ----------------------------------------------------------------------------
    const w = world.weaponCount > 0 ? world.weapons[0] : undefined;
    const tx = w?.turretX ?? pl.faceX;
    const ty = w?.turretY ?? pl.faceY;
    const aim = Math.atan2(ty, tx);
    // RECOIL: the mount slides back along its own axis and returns. The shell is long gone by
    // then - this is pure feedback, and it is the cheapest way to make firing feel like an event
    // rather than a stream of sprites appearing at the muzzle.
    const kick = this.turretKick > 0 ? (this.turretKick / TURRET_KICK_SEC) * TURRET_KICK_UNITS : 0;
    this.barrel.position.set(px - tx * kick, py - ty * kick);
    this.barrel.rotation = aim;
    this.barrel.tint = tint;

    this.drawShieldRim(pl.shieldLayers, px, py);
  }

  /**
   * The Energy Shield's rims: one blue ring per layer still standing.
   *
   * THE GEOMETRY IS REDRAWN ONLY WHEN THE COUNT CHANGES. A Graphics rebuilt every frame throws
   * away its geometry and re-tessellates two circles sixty times a second for a shape that changes
   * perhaps twice a minute; position and alpha are transform and tint, which cost nothing.
   *
   * It does NOT rotate with the chassis and does NOT yaw with the gait - it is a field, not a part
   * of the machine, and a ring that walked with the legs would read as painted on.
   */
  private drawShieldRim(layers: number, px: number, py: number): void {
    if (layers <= 0) {
      // `visible` rather than `clear()`: the geometry is worth keeping for the next recharge, and
      // shieldRimDrawn is left alone so coming back to the same count is free.
      this.shieldRim.visible = false;
      return;
    }

    if (layers !== this.shieldRimDrawn) {
      this.shieldRim.clear();
      for (let i = 0; i < layers; i++) {
        this.shieldRim
          .circle(0, 0, SHIELD_RIM_RADIUS + i * SHIELD_RIM_STEP)
          .stroke({ width: SHIELD_RIM_WIDTH, color: SHIELD_RIM_TINT, alpha: 1 });
      }
      this.shieldRimDrawn = layers;
    }

    this.shieldRim.visible = true;
    this.shieldRim.position.set(px, py);
    // Cosmetic clock, not sim time: the pulse must keep breathing through a level-up freeze, when
    // the whole simulation is stopped and the rim is one of the few things still moving.
    const pulse = (Math.sin(this.clock * SHIELD_PULSE_HZ * Math.PI * 2) + 1) * 0.5;
    this.shieldRim.alpha = SHIELD_ALPHA_MIN + (SHIELD_ALPHA_MAX - SHIELD_ALPHA_MIN) * pulse;
  }

  private drawProjectiles(world: World, alpha: number): void {
    const p = world.projectiles;
    const shells = this.projectiles;
    const trails = this.trails;

    shells.begin();
    trails.begin();
    this.strikeMarkers.clear();

    for (let d = 0; d < p.count; d++) {
      const x = lerp(p.prevX[d], p.x[d], alpha);
      const y = lerp(p.prevY[d], p.y[d], alpha);

      // ARTILLERY: no shell, no trail, no rotation. A ring on the ground, and it is culled against
      // its own blast radius rather than a fixed margin - a 111 u marker whose centre is just off
      // screen still covers ground the player can see and has to be drawn.
      if (p.visualId[d] === VIS_STRIKE_MARKER) {
        const radius = p.splashRadius[d];
        if (this.camera.isVisible(x, y, radius + 8)) this.drawStrikeMarker(world, d, x, y, radius);
        continue;
      }

      if (!this.camera.isVisible(x, y, 24)) continue;

      const angle = Math.atan2(p.vy[d], p.vx[d]);

      const t = trails.acquire();
      if (t !== undefined) {
        // Anchor (0.5, 0) puts the streak's tip on the shell so the ribbon trails behind it.
        t.position.set(x, y);
        t.rotation = angle + ROT_OFFSET.trail;
        t.scale.set(9 / PARTICLE_SRC, 34 / PARTICLE_SRC);
        t.tint = 0xffc890;
        t.alpha = 0.5;
      }

      const s = shells.acquire();
      if (s === undefined) break;
      s.position.set(x, y);
      s.rotation = angle + ROT_OFFSET.shell;
      // visualId is sim-owned data, copied onto each projectile at spawn. Read per projectile
      // rather than per weapon slot, so a round already in flight keeps its own look if the rack
      // that fired it is upgraded behind it.
      //
      // THE TWO RACKS SHARE ONE TEXTURE and differ only in proportion: the art points up, so the
      // sprite's local Y is the missile's LENGTH and its local X is the width. Short comes out
      // squat and fat, long comes out longer and thinner.
      const vis = p.visualId[d];
      if (vis === VIS_MISSILE_SHORT) {
        s.texture = this.tex.missile;
        s.scale.set(MISSILE_SHORT_SCALE_X, MISSILE_SHORT_SCALE_Y);
      } else if (vis === VIS_MISSILE_LONG) {
        s.texture = this.tex.missile;
        s.scale.set(MISSILE_LONG_SCALE_X, MISSILE_LONG_SCALE_Y);
      } else if (vis === VIS_SLUG) {
        s.texture = this.tex.slug;
        s.scale.set(SLUG_SCALE);
      } else {
        s.texture = this.tex.shell;
        s.scale.set(SHELL_SCALE);
      }
      s.alpha = 1;
      s.tint = 0xffffff;
    }

    shells.end();
    trails.end();
  }

  /**
   * One artillery strike marker: a static ring at the blast radius, a ring closing inward on the
   * fuse, four crosshair ticks, and a faint wash of red over the ground between them.
   *
   * THE FUSE COMES FROM THE WEAPON THAT FIRED IT, through `ownerWeapon` - the same route
   * updateProjectiles uses to read a missile's turn rate. Not from a constant: the whole point of
   * the closing ring is that it reaches the centre exactly when the shell lands, and a hardcoded
   * 0.7 would silently desynchronise the instant a tier or a tuning sweep moved the fuse.
   */
  private drawStrikeMarker(world: World, d: number, x: number, y: number, radius: number): void {
    if (radius <= 0) return;
    const g = this.strikeMarkers;
    const p = world.projectiles;

    // Fraction of the fuse still to burn, 1 at launch down to 0 on impact. Guarded rather than
    // trusted: a weapon slot that has since been overwritten would give a 0 flight time, and the
    // marker degrades to a full ring instead of dividing by zero.
    const fuse = world.weapons[p.ownerWeapon[d]]?.stats.flightTime ?? 0;
    const left = fuse > 0 ? p.lifeSec[d] / fuse : 1;
    const t = left < 0 ? 0 : left > 1 ? 1 : left;

    g.circle(x, y, radius).fill({ color: STRIKE_TINT, alpha: STRIKE_FILL_ALPHA });
    g.circle(x, y, radius).stroke({
      width: STRIKE_RING_WIDTH,
      color: STRIKE_TINT,
      alpha: STRIKE_RING_ALPHA,
    });

    // The closing ring. It stops short of zero because a ring that shrinks to a point spends its
    // last frames as a dot, which reads as a rendering artefact rather than as an impact.
    const inner = radius * (STRIKE_MIN_FRAC + (1 - STRIKE_MIN_FRAC) * t);
    g.circle(x, y, inner).stroke({ width: STRIKE_RING_WIDTH, color: STRIKE_TINT, alpha: 0.95 });

    // Crosshair ticks, outward from the ring. Four short strokes are the whole difference between
    // "a red circle" and "something is aimed here".
    const tick = radius * STRIKE_TICK_FRAC;
    g.moveTo(x - radius - tick, y).lineTo(x - radius + tick, y);
    g.moveTo(x + radius - tick, y).lineTo(x + radius + tick, y);
    g.moveTo(x, y - radius - tick).lineTo(x, y - radius + tick);
    g.moveTo(x, y + radius - tick).lineTo(x, y + radius + tick);
    g.stroke({ width: STRIKE_RING_WIDTH, color: STRIKE_TINT, alpha: STRIKE_RING_ALPHA });
  }
}

/** Linear interpolation between the previous tick's value and this tick's. */
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
