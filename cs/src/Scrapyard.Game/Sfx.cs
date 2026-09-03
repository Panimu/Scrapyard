using Microsoft.Xna.Framework.Audio;

using Scrapyard.Core;

namespace Scrapyard.Game;

/// <summary>
/// THE THING THAT ACTUALLY MAKES A NOISE on the desktop build, and the routing that decides which.
/// </summary>
/// <remarks>
/// <para>
/// The counterpart of <c>src/render/audio/sfxPlayer.ts</c>, and the same three-way split the web
/// build has: <see cref="SfxTable"/> is the MIX (generated from the TypeScript, because nothing
/// about sound is in the world hash and a mistyped gain would fail no test in either language),
/// <see cref="SfxTriggers"/> is the ROUTING, and this is the part that owns a speaker. Only this
/// file touches MonoGame, which is what lets the headless tests compile the other two directly.
/// </para>
/// <para>
/// IT MUST NEVER BE ABLE TO BREAK A RUN. Every entry point is safe to call with no audio hardware,
/// with a clip that failed to load, and before anything has loaded at all. A missing sound is
/// silence, reported once to the console and never again. A game that crashes because a machine
/// has no sound card is a worse game than a quiet one.
/// </para>
/// <para>
/// WAV, NOT MP3, AND THAT IS NOT A PREFERENCE. <see cref="SoundEffect.FromStream"/> reads PCM WAV
/// and nothing else - it will not decode the MP3s the web build ships. `sfx/publish.mjs` writes
/// both formats from the same conditioning pass into <c>cs/assets/sfx/</c>, so the two front-ends
/// cannot drift in level or length.
/// </para>
/// <para>
/// THROTTLES ARE THE WHOLE DIFFERENCE BETWEEN SOUND AND NOISE. Forty runts dying in one tick is
/// forty <c>die_grunt</c> requests; playing all of them is not loud, it is white noise. Each clip
/// carries its own floor in the table and this is where it is enforced.
/// </para>
/// </remarks>
public sealed class Sfx : IDisposable
{
    /// <summary>Loaded clips, indexed by <see cref="SfxId"/>. Null where loading failed.</summary>
    private readonly SoundEffect?[] _clips = new SoundEffect?[SfxTable.All.Length];

    /// <summary>When each clip last played, on <see cref="_now"/>'s clock. Negative = never.</summary>
    private readonly double[] _lastPlayed = new double[SfxTable.All.Length];

    /// <summary>One fader per bus, so a mixer can exist later without touching a call site.</summary>
    private readonly float[] _busGain;

    /// <summary>
    /// HELD VOICES, keyed by whatever the caller identifies them with - a weapon slot, the chest.
    /// </summary>
    /// <remarks>
    /// A voice is in here because someone needs to be able to STOP it. That is obvious for a beam,
    /// which runs until the trigger is released; it is equally true of the chest reels, which are a
    /// plain one-shot the player can cut short by skipping the spin. Whether the clip LOOPS is the
    /// table's business, not this dictionary's - the two questions are unrelated.
    /// </remarks>
    private readonly Dictionary<int, (SfxId Id, SoundEffectInstance Inst)> _held = new();

    /// <summary>
    /// The chest's voice key. Beams key by weapon slot - 0..MaxWeapons - so a second caller
    /// choosing by hand would eventually collide with one, and the symptom would be a chest that
    /// silences a laser. One constant well clear of any slot cannot.
    /// </summary>
    public const int VoiceChest = 1000;

    /// <summary>Scratch for <see cref="SoundBeams"/>, reused so a per-frame check allocates nothing.</summary>
    private readonly HashSet<int> _liveSlots = new();
    private readonly List<int> _endedSlots = new();

    /// <summary>Milliseconds since construction. Advanced by <see cref="Update"/>.</summary>
    private double _now;

    /// <summary>False when the machine has no audio at all. Everything below tolerates it.</summary>
    private readonly bool _ok;

    private float _volume = 1;
    private bool _muted;

    public Sfx()
    {
        for (int i = 0; i < _lastPlayed.Length; i++) _lastPlayed[i] = double.NegativeInfinity;

        int buses = Enum.GetValues<SfxBus>().Length;
        _busGain = new float[buses];
        for (int i = 0; i < buses; i++) _busGain[i] = 1f;

        string root = SfxTriggers.FindRoot();
        int loaded = 0;
        int failed = 0;
        foreach (var def in SfxTable.All)
        {
            string path = Path.Combine(root, def.Clip + ".wav");
            try
            {
                using var stream = File.OpenRead(path);
                _clips[(int)def.Id] = SoundEffect.FromStream(stream);
                loaded++;
            }
            catch (Exception e)
            {
                // ONE LINE PER MISSING CLIP, because the name IS the fix - and the alternative,
                // discovering it as silence during a run, is how the whole library once shipped
                // unreachable on the web side without a single test noticing.
                Console.Error.WriteLine($"[sfx] no clip for {def.Id} ({path}): {e.Message}");
                failed++;
            }
        }

        // A machine with no audio device throws on the FIRST FromStream and every one after it.
        // That is not 48 errors worth reporting, it is one fact: this build is silent.
        _ok = loaded > 0;
        if (!_ok && failed > 0) Console.Error.WriteLine("[sfx] no audio - the game will run silently");
    }

    // -----------------------------------------------------------------------------------------
    // Mixer
    // -----------------------------------------------------------------------------------------

    public void SetMuted(bool muted)
    {
        _muted = muted;
        if (muted) StopAll();
    }

    public void SetVolume(float v) => _volume = v < 0 ? 0 : v > 1 ? 1 : v;

    /// <summary>Advances the throttle clock. Called once a frame with the frame's own elapsed time.</summary>
    public void Update(double elapsedMs) => _now += elapsedMs;

    // -----------------------------------------------------------------------------------------
    // Playing
    // -----------------------------------------------------------------------------------------

    /// <summary>
    /// Fires one sound, if it is loaded and not throttled.
    /// </summary>
    /// <param name="scale">
    /// A per-call multiplier on the table's gain, for a sound that should be quieter because of
    /// WHERE it happened rather than WHAT it was. Everything else about the mix belongs in the
    /// table, where it can be read next to its neighbours.
    /// </param>
    public void Play(SfxId id, float scale = 1f)
    {
        if (!_ok || _muted) return;
        int i = (int)id;
        if ((uint)i >= (uint)_clips.Length) return;
        var clip = _clips[i];
        if (clip is null) return;

        var def = SfxTable.All[i];
        if (def.ThrottleMs > 0 && _now - _lastPlayed[i] < def.ThrottleMs) return;
        _lastPlayed[i] = _now;

        float vol = def.Gain * _busGain[(int)def.Bus] * _volume * (scale < 0 ? 0 : scale);
        if (vol <= 0) return;
        try
        {
            // MonoGame pools the voices behind this and returns false when none is free, which is
            // the voice cap the web player has to keep by hand. Dropping the newest request is the
            // right answer: reaching the cap means a throttle has already failed upstream.
            clip.Play(vol > 1f ? 1f : vol, 0f, 0f);
        }
        catch
        {
            // A device lost mid-run. Silence, never a throw.
        }
    }

    /// <summary>
    /// Starts a clip under <paramref name="key"/> that can be stopped later, or leaves it alone if
    /// that key is already running the same sound.
    /// </summary>
    /// <remarks>
    /// That second half is what makes it safe to call every frame, which the beams do: they are
    /// held for whole seconds and restarting one each frame would be a machine gun made of laser.
    /// The chest calls it once, and wants the key only so a skip can cut the spin short.
    /// </remarks>
    public void StartVoice(int key, SfxId id)
    {
        if (!_ok || _muted) return;
        if (_held.TryGetValue(key, out var live))
        {
            if (live.Id == id) return;
            StopVoice(key);
        }
        int i = (int)id;
        if ((uint)i >= (uint)_clips.Length) return;
        var clip = _clips[i];
        if (clip is null) return;

        var def = SfxTable.All[i];
        try
        {
            var inst = clip.CreateInstance();
            // FROM THE TABLE, not from the fact that it is held. A beam loops; the reels do not.
            inst.IsLooped = def.Loop;
            float vol = def.Gain * _busGain[(int)def.Bus] * _volume;
            inst.Volume = vol > 1f ? 1f : vol < 0f ? 0f : vol;
            inst.Play();
            _held[key] = (id, inst);
        }
        catch
        {
            // No instance available, or no device. The beam is drawn either way.
        }
    }

    /// <summary>Stops the voice under <paramref name="key"/>. Safe for a key that never started one.</summary>
    public void StopVoice(int key)
    {
        if (!_held.Remove(key, out var live)) return;
        try
        {
            live.Inst.Stop();
            live.Inst.Dispose();
        }
        catch
        {
            // Already gone. Nothing to do, and certainly nothing worth throwing over.
        }
    }

    /// <summary>Everything off - a run ending, or the window going away.</summary>
    public void StopAll()
    {
        _endedSlots.Clear();
        foreach (int key in _held.Keys) _endedSlots.Add(key);
        foreach (int key in _endedSlots) StopVoice(key);
        _endedSlots.Clear();
    }

    public void Dispose()
    {
        StopAll();
        foreach (var clip in _clips) clip?.Dispose();
    }

    // -----------------------------------------------------------------------------------------
    // Dispatch
    // -----------------------------------------------------------------------------------------

    /// <summary>
    /// Sounds one drained event. Table-driven off <see cref="SfxTable.ByEvent"/>, with the kinds
    /// whose sound depends on a payload routed above.
    /// </summary>
    /// <remarks>
    /// CALLED FOR EVERY EVENT, before the visual switch and independently of it. The renderer's
    /// switch does not handle every kind that makes a noise - a level-up, a chest, a reload - so
    /// per-case calls would silently miss exactly those, and a table cannot drift from the one the
    /// tests assert against.
    /// </remarks>
    public void PlayFor(World world, int kind, double a, double c, double d, double e)
    {
        SfxId? id;
        switch (kind)
        {
            case EventKind.EnemyKilled:
                // `d` is the reason - a recycled body is not a death. `e` carries the rank.
                if ((int)d == EnemyAI.KillReasonDespawned) return;
                id = SfxTriggers.DeathSfxFor((int)e);
                break;

            case EventKind.ProjectileDetonated:
                id = SfxTriggers.BlastSfxFor(c); // payload c is the splash RADIUS
                break;

            case EventKind.ConsumableTaken:
                id = SfxTriggers.ConsumableSfxFor((int)d); // payload d is the pickup KIND
                break;

            case EventKind.SpecialEvent:
                id = SfxTriggers.SpecialEventSfxFor((int)a); // payload a is the event id
                break;

            case EventKind.ProjectileHit:
                id = SfxTriggers.HitSfxFor((int)e);
                break;

            case EventKind.WeaponFired:
            {
                // WHICH GUN, from the fifth payload's weapon slot.
                int slot = (int)e;
                if ((uint)slot >= (uint)world.WeaponCount) return;
                id = SfxTriggers.FireSfxFor(world.Weapons[slot].DefId);
                break;
            }

            default:
                id = (uint)kind < (uint)SfxTable.ByEvent.Length ? SfxTable.ByEvent[kind] : null;
                break;
        }

        if (id is not null) Play(id.Value);
    }

    /// <summary>
    /// Starts and stops the beam loops from what the simulation published this frame.
    /// </summary>
    /// <remarks>
    /// A beam is the one weapon whose sound is a STATE rather than an event: it is held down, so
    /// there is no single moment to hang a one-shot on. The published beam list is the state, and
    /// a slot that stops appearing in it has stopped firing.
    /// </remarks>
    public void SoundBeams(World world)
    {
        if (!_ok) return;
        _liveSlots.Clear();
        var beams = world.Beams;
        for (int i = 0; i < beams.Count; i++)
        {
            int slot = beams.WeaponIdx[i];
            if (slot < 0 || slot >= world.WeaponCount) continue;
            int defId = world.Weapons[slot].DefId;
            if ((uint)defId >= (uint)SfxTable.FireByWeapon.Length) continue;
            var id = SfxTable.FireByWeapon[defId];
            if (!SfxTable.All[(int)id].Loop) continue;
            _liveSlots.Add(slot);
            StartVoice(slot, id);
        }

        // Anything that was looping and is no longer published has stopped firing. Collected first
        // rather than removed inside the walk, which would invalidate the enumerator.
        _endedSlots.Clear();
        foreach (int key in _held.Keys) if (!_liveSlots.Contains(key)) _endedSlots.Add(key);
        foreach (int key in _endedSlots) StopVoice(key);
        _endedSlots.Clear();
    }
}
