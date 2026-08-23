using Microsoft.Xna.Framework;
using Microsoft.Xna.Framework.Graphics;

namespace Scrapyard.Game;

/// <summary>
/// Muzzle flashes, impacts, embers, scorch marks and puffs. Port of <c>src/render/effects.ts</c>.
/// </summary>
/// <remarks>
/// <para>
/// PURELY PRESENTATIONAL, and two consequences follow that are easy to get wrong. It is advanced by
/// WALL-CLOCK time rather than by the simulation's 1/60, because a flash is a thing the eye sees
/// rather than a thing the world contains - and a machine rendering at 144 Hz should get a smooth
/// flash rather than a stepped one. And it draws its randomness from its OWN generator, never
/// <c>world.Rng</c>: a stream the simulation draws from must not be advanced by the picture, or the
/// number of frames drawn would decide the run.
/// </para>
/// <para>
/// ONE POOL, FIXED SIZE, oldest slot reused when full. An effect that cannot be allocated is simply
/// not shown: dropping a spark under load is invisible, and growing an array mid-frame to hold one
/// is not.
/// </para>
/// <para>
/// NO DAMAGE NUMBERS. The original has none and this does not add any - a number over every body is
/// a design decision, and inventing one here would be making it on the game's behalf.
/// </para>
/// </remarks>
public sealed class Effects
{
    private const int Capacity = 256;

    private const int KindMuzzle = 0;
    private const int KindFlash = 1;
    private const int KindBurst = 2;
    private const int KindPuff = 3;
    private const int KindSpark = 4;
    private const int KindSparkle = 5;
    private const int KindEmber = 6;
    private const int KindScorch = 7;

    private const double MuzzleLife = 0.08;
    private const double MuzzleUnits = 40;
    private const double FlashLife = 0.12;
    private const double BurstLife = 0.2;
    private const double SparkLife = 0.1;
    private const double SparkleLife = 0.18;
    /// <summary>The cut-out flash, long enough to be seen and short enough not to linger.</summary>
    private const double OverheatLife = 0.22;

    private const double EmberLife = 0.36;
    private const double ScorchLife = 0.42;
    private const double BeamStartLife = 0.14;
    private const double ShieldBreakLife = 0.3;
    private const double ArtilleryBlastLife = 0.34;

    private const double EmberSpeedMin = 55;
    private const double EmberSpeedMax = 190;
    private const double EmberDrag = 3.4;
    private const double EmberSpread = 1.0;

    private const double ScorchAlpha = 0.34;
    private static readonly Color ScorchTint = new(0x21, 0x10, 0x0c);

    /// <summary>Frames in the puff strip, and how long each is held.</summary>
    private const int PuffFrames = 7;

    private const double PuffFrameSec = 0.06;

    private readonly int[] _kind = new int[Capacity];
    private readonly double[] _x = new double[Capacity];
    private readonly double[] _y = new double[Capacity];
    private readonly double[] _vx = new double[Capacity];
    private readonly double[] _vy = new double[Capacity];
    private readonly double[] _age = new double[Capacity];
    private readonly double[] _life = new double[Capacity];
    private readonly double[] _rot = new double[Capacity];
    private readonly double[] _size0 = new double[Capacity];
    private readonly double[] _size1 = new double[Capacity];
    private readonly Color[] _tint = new Color[Capacity];
    private int _count;

    /// <summary>
    /// The effects' own randomness.
    /// </summary>
    /// <remarks>
    /// NEVER <c>world.Rng</c>. Drawing from a simulation stream would make the run depend on how
    /// many frames were rendered, which is the one thing determinism cannot survive - and it would
    /// do so silently, on one machine and not another.
    /// </remarks>
    private readonly Random _rng = new(0x5ca19a2d);

    private readonly Sprites _sprites;

    public Effects(Sprites sprites) => _sprites = sprites;

    /// <summary>Drops everything. Called when a run starts, so the last run's explosions do not play.</summary>
    /// <summary>Live particles, for the debug readout. Nothing else has any business asking.</summary>
    public int Count => _count;

    public void Clear() => _count = 0;

    // -----------------------------------------------------------------------------------------

    private int Alloc(int kind, double x, double y, double life)
    {
        int i;
        if (_count < Capacity)
        {
            i = _count++;
        }
        else
        {
            // FULL: take the oldest slot. A dropped spark is invisible; a resize is not.
            i = 0;
            double oldest = -1;
            for (int k = 0; k < Capacity; k++)
            {
                double left = _life[k] - _age[k];
                if (left > oldest) continue;
                oldest = left;
                i = k;
            }
        }

        _kind[i] = kind;
        _x[i] = x;
        _y[i] = y;
        _vx[i] = 0;
        _vy[i] = 0;
        _age[i] = 0;
        _life[i] = life;
        _rot[i] = 0;
        _size0[i] = 1;
        _size1[i] = 1;
        _tint[i] = Color.White;
        return i;
    }

    private double Rand() => _rng.NextDouble();

    // -----------------------------------------------------------------------------------------

    /// <summary>The flame at a barrel's lip. Placed and rotated from the shot's own direction.</summary>
    public void Muzzle(double x, double y, double dirX, double dirY)
    {
        int i = Alloc(KindMuzzle, x, y, MuzzleLife);
        _rot[i] = System.Math.Atan2(dirY, dirX) + System.Math.PI / 2;
        _size0[i] = MuzzleUnits;
        _size1[i] = MuzzleUnits * 1.15;
        _tint[i] = new Color(0xff, 0xb0, 0x40);
    }

    /// <summary>A shell landing: a hot flash that expands fast, and a slower burst behind it.</summary>
    public void Impact(double x, double y, double scale = 1)
    {
        int a = Alloc(KindFlash, x, y, FlashLife);
        _size0[a] = 4 * scale;
        _size1[a] = 56 * scale;
        _tint[a] = new Color(0xff, 0xc0, 0x80);

        int b = Alloc(KindBurst, x, y, BurstLife);
        _rot[b] = Rand() * System.Math.PI * 2;
        _size0[b] = 22 * scale;
        _size1[b] = 52 * scale;
        _tint[b] = new Color(0xff, 0x80, 0x30);
    }

    /// <summary>The artillery's fuse going off: flash, burst, a scorch mark, and ten embers.</summary>
    public void ArtilleryBlast(double x, double y, double radius)
    {
        int f = Alloc(KindFlash, x, y, ArtilleryBlastLife);
        _size0[f] = radius * 0.5;
        _size1[f] = radius * 2.4;
        _tint[f] = new Color(0xff, 0xd0, 0xa0);

        int b = Alloc(KindBurst, x, y, ArtilleryBlastLife);
        _rot[b] = Rand() * System.Math.PI * 2;
        _size0[b] = radius * 0.8;
        _size1[b] = radius * 2.2;
        _tint[b] = new Color(0xff, 0x6a, 0x28);

        Scorch(x, y, radius * 1.6);
        for (int k = 0; k < 10; k++)
        {
            double a = k / 10.0 * System.Math.PI * 2 + Rand() * 0.5;
            Ember(x, y, System.Math.Cos(a), System.Math.Sin(a), new Color(0xff, 0xb0, 0x60));
        }
    }

    public void Spark(double x, double y)
    {
        int i = Alloc(KindSpark, x, y, SparkLife);
        _rot[i] = Rand() * System.Math.PI * 2;
        _size0[i] = 10;
        _size1[i] = 26;
        _tint[i] = new Color(0xff, 0xf0, 0xc0);
    }

    /// <summary>The smoke a body leaves. A seven-frame strip, held six hundredths each.</summary>
    public void Puff(double x, double y, double units)
    {
        int i = Alloc(KindPuff, x, y, PuffFrames * PuffFrameSec);
        _rot[i] = Rand() * System.Math.PI * 2;
        _size0[i] = units;
        _size1[i] = units * 1.35;
        _tint[i] = Color.White;
    }

    public void Sparkle(double x, double y, Color tint)
    {
        int i = Alloc(KindSparkle, x, y, SparkleLife);
        _rot[i] = Rand() * System.Math.PI * 2;
        _size0[i] = 6;
        _size1[i] = 20;
        _tint[i] = tint;
    }

    /// <summary>A thrown ember, slowed by drag rather than gravity - the yard has no up.</summary>
    public void Ember(double x, double y, double dirX, double dirY, Color tint)
    {
        int i = Alloc(KindEmber, x, y, EmberLife);
        double spread = (Rand() - 0.5) * EmberSpread;
        double cos = System.Math.Cos(spread);
        double sin = System.Math.Sin(spread);
        double ux = dirX * cos - dirY * sin;
        double uy = dirX * sin + dirY * cos;
        double speed = EmberSpeedMin + Rand() * (EmberSpeedMax - EmberSpeedMin);
        _vx[i] = ux * speed;
        _vy[i] = uy * speed;
        _rot[i] = System.Math.Atan2(uy, ux) + System.Math.PI / 2;
        _size0[i] = 7;
        _size1[i] = 2;
        _tint[i] = tint;
    }

    /// <summary>
    /// The debris a beam throws back off what it is burning.
    /// </summary>
    /// <remarks>
    /// SEPARATE FROM <see cref="Ember"/> because its life is jittered and it shrinks to nothing
    /// rather than to a visible speck: an ember cools, it does not bloom. A stream of them at a
    /// fixed lifetime pulses visibly, which reads as the weapon stuttering.
    /// </remarks>
    public void BeamEmber(double x, double y, double dirX, double dirY, Color tint)
    {
        int i = Alloc(KindEmber, x, y, EmberLife * (0.7 + Rand() * 0.6));
        double a = System.Math.Atan2(dirY, dirX) + (Rand() * 2 - 1) * EmberSpread;
        double speed = EmberSpeedMin + Rand() * (EmberSpeedMax - EmberSpeedMin);
        _vx[i] = System.Math.Cos(a) * speed;
        _vy[i] = System.Math.Sin(a) * speed;
        _rot[i] = a;
        _size0[i] = 7;
        _size1[i] = 1.5;
        _tint[i] = tint;
    }

    /// <summary>
    /// A laser cutting out.
    /// </summary>
    /// <remarks>
    /// FIRED ON THE EDGE where the weapon latches overheated, never on the level, so it marks the
    /// MOMENT the weapon dies rather than the whole time it is dead. Six sparks straight out of the
    /// emitter, evenly spread so it reads as a discharge rather than as another impact - six is the
    /// whole budget for the event, and it fires twice a burst.
    /// </remarks>
    public void OverheatBurst(double x, double y, Color tint)
    {
        int f = Alloc(KindFlash, x, y, OverheatLife);
        _size0[f] = 10;
        _size1[f] = 74;
        _tint[f] = new Color(0xff, 0xb0, 0x50);

        for (int k = 0; k < 6; k++)
        {
            double a = (k / 6.0) * System.Math.PI * 2 + Rand() * 0.6;
            BeamEmber(x, y, System.Math.Cos(a), System.Math.Sin(a),
                      Color.Lerp(tint, Color.White, 0.45f));
        }
    }

    /// <summary>
    /// A dark mark where something burned.
    /// </summary>
    /// <remarks>
    /// It fades rather than persisting: a permanent decal needs somewhere to live, and the only
    /// somewhere available is the world - which the renderer does not write to.
    /// </remarks>
    public void Scorch(double x, double y, double units)
    {
        int i = Alloc(KindScorch, x, y, ScorchLife);
        _rot[i] = Rand() * System.Math.PI * 2;
        _size0[i] = units;
        _size1[i] = units * 1.1;
        _tint[i] = ScorchTint;
    }

    /// <summary>The flare where a beam leaves the chassis.</summary>
    public void BeamStart(double x, double y, Color tint)
    {
        int i = Alloc(KindFlash, x, y, BeamStartLife);
        _size0[i] = 6;
        _size1[i] = 26;
        _tint[i] = tint;
    }

    /// <summary>A rim going down: a ring of embers, because a shield breaks outward.</summary>
    public void ShieldBreak(double x, double y, Color tint)
    {
        int f = Alloc(KindFlash, x, y, ShieldBreakLife);
        _size0[f] = 30;
        _size1[f] = 96;
        _tint[f] = tint;

        for (int k = 0; k < 12; k++)
        {
            double a = k / 12.0 * System.Math.PI * 2;
            Ember(x, y, System.Math.Cos(a), System.Math.Sin(a), tint);
        }
    }

    // -----------------------------------------------------------------------------------------

    /// <summary>Advances by WALL-CLOCK seconds. See the class remarks for why not by the tick.</summary>
    public void Update(double dt)
    {
        int i = 0;
        while (i < _count)
        {
            _age[i] += dt;
            if (_age[i] >= _life[i])
            {
                // Swap-remove, exactly as the pools do: order does not matter and a compaction pass
                // would cost more than the effect it removes.
                int last = --_count;
                if (i != last) Move(last, i);
                continue;
            }

            if (_kind[i] == KindEmber)
            {
                double drag = 1 - EmberDrag * dt;
                if (drag < 0) drag = 0;
                _vx[i] *= drag;
                _vy[i] *= drag;
                _x[i] += _vx[i] * dt;
                _y[i] += _vy[i] * dt;
            }

            i++;
        }
    }

    private void Move(int from, int to)
    {
        _kind[to] = _kind[from];
        _x[to] = _x[from];
        _y[to] = _y[from];
        _vx[to] = _vx[from];
        _vy[to] = _vy[from];
        _age[to] = _age[from];
        _life[to] = _life[from];
        _rot[to] = _rot[from];
        _size0[to] = _size0[from];
        _size1[to] = _size1[from];
        _tint[to] = _tint[from];
    }

    public void Draw(SpriteBatch batch, Camera cam)
    {
        for (int i = 0; i < _count; i++)
        {
            double t = _life[i] > 0 ? _age[i] / _life[i] : 1;
            if (t > 1) t = 1;

            string key;
            double alpha;

            switch (_kind[i])
            {
                case KindMuzzle: key = "fx_muzzle"; alpha = 1 - t; break;
                case KindFlash: key = "fx_flash"; alpha = 1 - t; break;
                case KindBurst: key = "fx_burst"; alpha = 1 - t; break;
                case KindSpark: key = "fx_sparkle"; alpha = 1 - t; break;
                case KindSparkle: key = "fx_sparkle"; alpha = 1 - t; break;
                case KindEmber: key = "fx_trail"; alpha = 1 - t; break;
                case KindScorch: key = "fx_burst"; alpha = ScorchAlpha * (1 - t); break;
                case KindPuff:
                    {
                        // The strip is seven separate files rather than one sheet, so the frame is
                        // chosen by name.
                        int frame = (int)(_age[i] / PuffFrameSec);
                        if (frame >= PuffFrames) frame = PuffFrames - 1;
                        key = $"puff_{frame}";
                        alpha = 1 - t * t;
                        break;
                    }
                default: continue;
            }

            var tex = _sprites.Get(key);
            if (tex is null) continue;

            double size = _size0[i] + (_size1[i] - _size0[i]) * t;
            var screen = cam.ToScreen(_x[i], _y[i]);
            var scale = new Vector2(
                (float)(size * cam.Scale / tex.Width),
                (float)(size * cam.Scale / tex.Height));
            batch.Draw(tex, screen, null, _tint[i] * (float)alpha, (float)_rot[i],
                       new Vector2(tex.Width / 2f, tex.Height / 2f), scale, SpriteEffects.None, 0f);
        }
    }
}
