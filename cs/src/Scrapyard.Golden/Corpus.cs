using System.Text.Json;

using Scrapyard.Core;

namespace Scrapyard.Golden;

/// <summary>
/// One recorded run out of <c>goldens/corpus.json</c>, decoded.
/// </summary>
public sealed class CorpusRun
{
    public required string Name { get; init; }
    public required int Seed { get; init; }
    public required int HeroId { get; init; }
    public required string LevelId { get; init; }
    public required int Ticks { get; init; }
    public required int HashEvery { get; init; }

    /// <summary>Two signed bytes per tick, interleaved moveX, moveY.</summary>
    public required sbyte[] Moves { get; init; }

    /// <summary>Sparse: tick to (buttons, chooseIndex). Any tick not listed uses 0 and -1.</summary>
    public required Dictionary<int, (int Buttons, int ChooseIndex)> Events { get; init; }

    public required string[] WorldHashes { get; init; }
    public required string[] StatsHashes { get; init; }
    public required int EndPhase { get; init; }

    public InputFrame InputAt(int t)
    {
        // THE BYTES ARE SIGNED. Reading them as `byte` turns every leftward input into a large
        // rightward one, and the run stays perfectly deterministic while being a different run.
        sbyte mx = t * 2 < Moves.Length ? Moves[t * 2] : (sbyte)0;
        sbyte my = t * 2 + 1 < Moves.Length ? Moves[t * 2 + 1] : (sbyte)0;
        var (buttons, choose) = Events.TryGetValue(t, out var e) ? e : (0, -1);
        // THE FRAME CARRIES THE QUANTISED AXES, not the dequantised doubles. int8 in [-127, 127] is
        // the wire format and the thing the hash sees; PlayerMovement is what turns it back into a
        // stick position. Dequantising here would hand the simulation a number it never receives in
        // a real run.
        return new InputFrame
        {
            MoveX = mx,
            MoveY = my,
            Buttons = buttons,
            ChooseIndex = choose,
        };
    }
}

/// <summary>
/// The corpus reader.
/// </summary>
/// <remarks>
/// REFUSES TO RUN ON A MISMATCH. If <c>formatVersion</c>, <c>hashAlgo</c> or <c>tickRate</c> differ
/// from what this expects it stops with an error rather than carrying on: a golden master that
/// misreads its own format and reports success is worse than not having one.
/// </remarks>
public static class Corpus
{
    public const int ExpectedFormatVersion = 1;
    public const string ExpectedHashAlgo = "fnv1a32/world-v3+stats-v1";
    public const int ExpectedTickRate = 60;

    public static List<CorpusRun> Load(string path)
    {
        using var doc = JsonDocument.Parse(File.ReadAllBytes(path));
        var root = doc.RootElement;

        int version = root.GetProperty("formatVersion").GetInt32();
        if (version != ExpectedFormatVersion)
        {
            throw new InvalidDataException(
                $"corpus formatVersion is {version}, this reader expects {ExpectedFormatVersion}");
        }

        string algo = root.GetProperty("hashAlgo").GetString()!;
        if (algo != ExpectedHashAlgo)
        {
            throw new InvalidDataException(
                $"corpus hashAlgo is '{algo}', this reader expects '{ExpectedHashAlgo}'");
        }

        int rate = root.GetProperty("tickRate").GetInt32();
        if (rate != ExpectedTickRate)
        {
            throw new InvalidDataException(
                $"corpus tickRate is {rate}, this reader expects {ExpectedTickRate}");
        }

        var runs = new List<CorpusRun>();
        foreach (var r in root.GetProperty("runs").EnumerateArray())
        {
            byte[] raw = Convert.FromBase64String(r.GetProperty("moves").GetString()!);
            var moves = new sbyte[raw.Length];
            Buffer.BlockCopy(raw, 0, moves, 0, raw.Length);

            var events = new Dictionary<int, (int, int)>();
            if (r.TryGetProperty("events", out var evs))
            {
                foreach (var e in evs.EnumerateArray())
                {
                    events[e[0].GetInt32()] = (e[1].GetInt32(), e[2].GetInt32());
                }
            }

            runs.Add(new CorpusRun
            {
                Name = r.GetProperty("name").GetString()!,
                Seed = r.GetProperty("seed").GetInt32(),
                HeroId = r.GetProperty("heroId").GetInt32(),
                LevelId = r.GetProperty("levelId").GetString()!,
                Ticks = r.GetProperty("ticks").GetInt32(),
                HashEvery = r.GetProperty("hashEvery").GetInt32(),
                Moves = moves,
                Events = events,
                WorldHashes = ReadHashes(r.GetProperty("world")),
                StatsHashes = ReadHashes(r.GetProperty("stats")),
                EndPhase = r.GetProperty("endPhase").GetInt32(),
            });
        }

        return runs;
    }

    private static string[] ReadHashes(JsonElement a)
    {
        var outv = new string[a.GetArrayLength()];
        for (int i = 0; i < outv.Length; i++) outv[i] = a[i].GetString()!;
        return outv;
    }
}
