# Prompt for ChatGPT — porting Scrapyard

> Fill in the two bracketed lines before sending. Everything else is factual and can go as-is.

---

I have a finished, working game and I'm considering porting it. I want your help thinking
through the port. **Target platform: [FILL IN — e.g. native iOS/Swift+SpriteKit, Unity, Godot 4,
Rust+wgpu, React Native, Steam desktop via Electron/Tauri…]**. **My priority is: [FILL IN — e.g.
App Store distribution / performance headroom / controller support / reusing my existing code].**

Please read the whole brief before answering. At the end I'll tell you exactly what I want out of you.

## 1. What the game is

**Scrapyard** — a Vampire-Survivors-style mech survivors game. One thumb, no aiming, one 15-minute
run against an endless horde. You pick a mech, it auto-fires at whatever is in range, you dodge and
collect XP gems, and every level-up offers three cards that add a weapon or deepen one you have.

Deliberately *heavy* in feel: slow mechs, real reload/heat/rearm limiters instead of a single
universal cooldown, and no dodge-roll or dash.

- Current form: web game, TypeScript + PixiJS, built with Vite, installed as a PWA.
- Primary target device: **mobile Safari on an iPhone**, fullscreen via Add to Home Screen, playable
  offline. Portrait, one virtual thumbstick bottom-left, everything else automatic.
- It ships as a static site on GitHub Pages; there is also a single-file HTML build for sharing.
- Scale: ~22k lines of TypeScript (about 10.7k of that is the simulation), 188 unit tests in 9 files,
  ~2 MB of sprite assets.

## 2. The architecture, which is the whole point

There is one hard line through the codebase:

```
src/core/     PURE TypeScript. No PixiJS, no DOM, no browser globals, no wall-clock time.
              Runs in bare Node. This is the game.
src/render/   PixiJS. Reads the World and draws it. Owns zero rules.
src/ui/       DOM overlays: virtual stick, HUD, level-up cards, run summary, mech select.
src/sim/      Headless harness. A bot plays the game in Node and prints a timeline.
src/main.ts   The ONLY file allowed to touch wall-clock time.
```

**The simulation is a deterministic fixed-timestep pure function.** `stepWorld(world, input)` takes
no delta — one call is exactly 1/60 s, always. *All* player intent, including which level-up card was
chosen, arrives as an `InputFrame`, so an entire run is `{ seed, heroId, InputFrame[] }` and nothing
else. Concretely this buys:

- A headless balance harness (`npm run sim`, `npm run dps`) that replays and re-measures the game in
  Node with no phone, no rendering and no deploy.
- A phone session that reproduces exactly on a laptop. The joystick's float output is quantised to
  int8 at the layer boundary so the recorded input stream is byte-exact.
- Screen size and pause cannot affect the game. The core never learns the viewport dimensions
  (iOS can't lock orientation, so screen shape must never change what the game does); pause is
  implemented as `main.ts` simply not calling `stepWorld`.

Determinism is *enforced*, not aspirational: a separate `tsconfig.core.json` compiles `src/core`
alone with `"lib": ["ES2022"], "types": []`, so a stray `window` or `performance.now()` inside the
simulation is a compile error. `Math.pow`, `Math.sin` and `Math.cos` are banned in core (there's a
seeded PRNG and a precomputed trig/growth-multiplier table instead).

**Data layout:** structure-of-arrays typed-array pools (`Float32Array`/`Int32Array`), fixed capacity
allocated once at world creation, never grown. `ENEMY_CAP` 512, `PROJECTILE_CAP` 256, `PICKUP_CAP`
512, with lower director caps (300 live enemies, 400 gems) so allocation can never silently fail.
Dead entities are swap-removed once per tick, which means **dense indices are only valid within a
tick** — a rule the renderer has to respect. Broad phase is a spatial hash grid (64-unit cells,
4096 masked buckets), rebuilt every tick.

**The tick is 13 ordered stages,** and the order is a contract: begin → difficulty → spawning →
player movement → world wrap → enemy AI → rebuild spatial hash → weapons → projectiles → collision
→ damage → pickups → progression → reap dead → end. Events (hits, kills, level-ups, shield breaks,
detonations) are written to a fixed-size 1024-entry ring buffer that the render layer drains for
one-shot effects.

**Renderer rules:** it may never write to the World (a screen shake that nudged the player would
break replay determinism), and it may never cache positions by dense index. Interpolation reads the
pools' own `prevX/prevY`, which the core keeps aligned through swap-removal — a renderer-side cache
produces a one-frame teleport streak on every kill.

## 3. Content scale (all data-driven, all in the core)

- **8 weapons** — Cannon, three lasers (short/medium/long), short and long missile racks, machine
  gun, artillery. Three *different* limiters on purpose: cooldown (cannon, missiles, artillery),
  heat build-up with a cut-out and resume threshold (lasers), and magazine + reload (machine gun).
  Each has a 7-tier upgrade ladder.
- **6 passives** (range, damage, fire rate, speed, ablative plate, energy shield), also 7 tiers each.
- **5 weapon slots and 5 passive slots** against 8 and 6 available, so a run is a choice rather than
  a collection.
- **16 mechs**, each with different base stats, a starting weapon, and a unique per-weapon bonus
  (extra pierce on the cannon, an extra missile, 50% better heat dispersion on one laser, etc.).
  One starts with no weapon at all and only a shield.
- **Enemies:** 5 chassis archetypes × 4 stat "flavours" × 3 ranks (regular/elite/boss), driven by a
  15-entry **cycle ladder** — one new creature per 120 s of run time, ranks being faction recolours
  of the same hull. A director controls spawn pressure inside a 900-unit sight radius around the
  player and spawns on a 560-unit ring so nothing ever pops in on screen.
- Stat resolution has a fixed order that everything depends on: `base → all additive terms → all
  multiplicative terms`.
- The world is currently a torus (walk far enough east and you come back from the west), implemented
  *without* torus arithmetic: positions live on an infinite plane and one pass per tick relocates
  every entity to whichever wrapped copy is nearest the player, so every ordinary `b - a` subtraction
  in the simulation stays correct.

## 4. Art and assets

Sprites are Kenney CC0 packs (sci-fi RTS, robot pack, space shooter, particles) plus mech sprites
and app icons **generated procedurally by scripts** — a headless Chromium canvas script and a
minimal hand-rolled PNG encoder — rather than authored by hand. Effects (explosions, beams, shield
rims, artillery blast rings, scorch marks) are drawn with immediate-mode vector graphics, not
sprites. There is no artist and no art pipeline beyond `node tools/prepare_assets.mjs`.

## 5. Constraints that are non-negotiable in any port

1. **Determinism survives.** `{ seed, heroId, inputs[] }` must still replay bit-identically, and the
   headless harness must still run the real simulation with no renderer attached. This is the
   project's main development tool; a port that loses it is worse than no port.
2. **The core/render line survives**, mechanically enforced if the target language allows it.
3. **Fixed 1/60 s timestep**, no variable delta reaching the simulation.
4. **No allocation in the hot loop.** Fixed pools, preallocated scratch, no per-tick garbage.
5. **60 fps on an iPhone** with ~120–300 live enemies, a few hundred projectiles and gems on screen.
6. **One-thumb portrait play.** No second stick, no aim, no button the game requires you to hit.
7. Zero-friction distribution matters to me. Today it is a URL with no account and no install step,
   and every push redeploys it.

## 6. What I want from you

1. **Is this port worth doing, given my stated priority?** Say so plainly, including "no" and why.
2. **Where the architecture maps cleanly onto the target and where it fights it** — specifically the
   deterministic fixed-step core, the SoA typed pools, and the enforced core/render split. Name the
   target's equivalent of each, or say there isn't one.
3. **The determinism risks specific to the target**: float behaviour, math-library differences across
   platforms and compiler versions, whether its engine loop will hand me a fixed step or fight me
   for it, and whether the physics/collision facilities are usable or must be bypassed.
4. **A realistic effort estimate**, broken down by layer (simulation / renderer / UI / asset pipeline
   / build & distribution), and be honest about which layer is the actual cost. Assume the simulation
   is the part I'd most want to translate mechanically rather than redesign.
5. **What I lose.** Concretely: distribution friction, iteration speed, the headless harness, the
   single-file share build, PWA offline play.
6. **A cheaper alternative that gets me my stated priority without a port**, if one exists.

Be specific and skeptical. I'd rather hear "this is 3 months of work to gain nothing" than a plan.
Where you're guessing about the target platform's behaviour, say you're guessing.
