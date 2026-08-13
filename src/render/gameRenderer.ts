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
 * second blend-state flush for nothing.
 */

import { Application, Container, Graphics, Sprite, Texture, TilingSprite } from 'pixi.js';
import {
  ARCHETYPES,
  ENEMY_FLAG_BOSS,
  EV_BOSS_SPAWNED,
  EV_ENEMY_DAMAGED,
  EV_ENEMY_KILLED,
  EV_GEM_COLLECTED,
  EV_PLAYER_DAMAGED,
  EV_PROJECTILE_HIT,
  EV_WEAPON_FIRED,
  FLAVOURS,
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
  SHELL_SCALE,
  bossScale,
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

/**
 * Turret barrel. Drawn from Texture.WHITE so it batches with the health bars rather than adding
 * a texture bind, and long enough to protrude past the 52 u chassis so its heading is readable.
 */
const BARREL_LEN = 44;
const BARREL_W = 9;
const BARREL_TINT = 0x232a33;

/** Player hit feedback, seconds. */
const PLAYER_FLASH_SEC = 0.12;

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
  private readonly trails: SpritePool;
  private readonly projectiles: SpritePool;
  private readonly glows: SpritePool;
  private readonly beams: BeamLayer;
  private readonly effects: Effects;

  /** Wall-clock seconds since boot, for cosmetic cycles (gem bob). Never touches the sim. */
  private clock = 0;
  private playerFlash = 0;

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
    this.barrel = new Sprite({ texture: Texture.WHITE, roundPixels: true });
    this.barrel.anchor.set(0.1, 0.5); // pivot just behind the mech centre
    this.barrel.tint = BARREL_TINT;
    this.mech = new Sprite({ texture: tex.mechs[0], roundPixels: true });
    this.mech.anchor.set(0.5, 0.5);
    this.mech.scale.set(MECH_SCALE);
    // Barrel ON TOP of the chassis. The Kenney top-view mech is a near-symmetric slab of plate
    // over treads with no visible muzzle, so without a drawn barrel the player has no cue at all
    // for where the turret is pointing - and turret traverse is the weapon's whole texture.
    this.playerLayer.addChild(this.mech, this.barrel);

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
    this.beams = new BeamLayer(tex);
    this.effects = new Effects(tex);

    this.letterbox = new Graphics({ label: 'letterbox' });

    this.world.addChild(
      this.pickups.container,
      this.enemies.container,
      this.hpBars.container,
      this.playerLayer,
      this.projectiles.container,
      this.effects.normalPool.container,
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

    this.drainEvents(world);
    this.effects.update(dtSec);
    this.camera.update(dtSec);

    const px = lerp(world.player.prevX, world.player.x, alpha);
    const py = lerp(world.player.prevY, world.player.y, alpha);
    this.camera.follow(px, py);

    this.drawFloor();
    this.drawPickups(world, alpha);
    this.drawEnemies(world, alpha);
    this.drawPlayer(world, px, py);
    this.drawProjectiles(world, alpha);
    // NOT interpolated, unlike everything above it: the endpoints are the ones the simulation
    // published this tick, so the line and the damage can never disagree.
    this.beams.draw(world, this.clock);
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
        case EV_WEAPON_FIRED:
          // Payload is muzzle position then the shell's unit direction - everything needed to
          // place and rotate the flash without recomputing anything.
          this.effects.muzzle(a, b, c, d);
          this.camera.kick(c, d);
          break;

        case EV_ENEMY_DAMAGED:
          this.effects.spark(a, b);
          break;

        case EV_PROJECTILE_HIT:
          this.effects.impact(a, b);
          break;

        case EV_ENEMY_KILLED:
          if (d !== KILL_REASON_DESPAWNED) this.effects.puff(a, b, 32);
          break;

        case EV_PLAYER_DAMAGED:
          this.playerFlash = PLAYER_FLASH_SEC;
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

    const bossBase = bossScale();

    for (let d = 0; d < p.count; d++) {
      const x = lerp(p.prevX[d], p.x[d], alpha);
      const y = lerp(p.prevY[d], p.y[d], alpha);
      const radius = p.radius[d];
      if (!this.camera.isVisible(x, y, radius)) continue;

      const s = pool.acquire();
      if (s === undefined) break;

      const typeId = p.typeId[d];
      const isBoss = (p.flags[d] & ENEMY_FLAG_BOSS) !== 0;
      const flavour = FLAVOURS[p.flavourId[d]];

      s.texture = tex.enemies[typeId] ?? tex.enemies[0];
      const base = (isBoss ? bossBase : tex.enemyScale[typeId]) * (flavour?.renderScale ?? 1);

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
      // this additive rim is the only cue the player gets. It uses the same soft-flash texture
      // as the impact FX so it batches with them instead of adding a texture bind.
      if (flavour?.renderGlow === true) {
        const g = glows.acquire();
        if (g !== undefined) {
          g.position.set(x, y);
          g.scale.set((radius * 3.4) / PARTICLE_SRC);
          g.tint = 0xff4030;
          g.alpha = 0.32;
          g.rotation = 0;
        }
      }

      const arch = ARCHETYPES[p.archetype[d]];
      if (arch?.showHpBar === true && p.hp[d] < p.maxHp[d]) {
        this.drawHpBar(bars, x, y, radius, arch.drawSize, p.hp[d] / p.maxHp[d]);
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

  private drawPlayer(world: World, px: number, py: number): void {
    const pl = world.player;

    // The chassis faces velocity; the turret is independent and driven by the weapon instance,
    // which is what makes the mech read as "walking one way, shooting another".
    this.mech.position.set(px, py);
    this.mech.rotation = Math.atan2(pl.faceY, pl.faceX) + ROT_OFFSET.mech;
    this.mech.tint = this.playerFlash > 0 ? 0xffb0a8 : 0xffffff;

    const w = world.weaponCount > 0 ? world.weapons[0] : undefined;
    const tx = w?.turretX ?? pl.faceX;
    const ty = w?.turretY ?? pl.faceY;
    this.barrel.position.set(px, py);
    this.barrel.rotation = Math.atan2(ty, tx);
    this.barrel.scale.set(BARREL_LEN, BARREL_W);
  }

  private drawProjectiles(world: World, alpha: number): void {
    const p = world.projectiles;
    const shells = this.projectiles;
    const trails = this.trails;

    shells.begin();
    trails.begin();

    for (let d = 0; d < p.count; d++) {
      const x = lerp(p.prevX[d], p.x[d], alpha);
      const y = lerp(p.prevY[d], p.y[d], alpha);
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
      s.scale.set(SHELL_SCALE);
      s.alpha = 1;
      s.tint = 0xffffff;
    }

    shells.end();
    trails.end();
  }
}

/** Linear interpolation between the previous tick's value and this tick's. */
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
