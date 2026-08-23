using Microsoft.Xna.Framework.Graphics;

namespace Scrapyard.Game;

/// <summary>
/// The texture table, loaded straight from <c>public/sprites/</c>.
/// </summary>
/// <remarks>
/// <para>
/// NOT THROUGH THE CONTENT PIPELINE. The sprites are already generated (<c>npm run mechs</c> and
/// friends), already checked in, and already shared with the web build. Running them through
/// MonoGame's build step would produce a second copy that can drift from the first, and the first
/// is the one the artist-facing tools write.
/// </para>
/// <para>
/// LOADED LAZILY AND CACHED. There are 431 files and a run touches a small fraction of them - the
/// current level's creatures, one chassis, a handful of props. Loading the lot at startup costs a
/// second of black screen to prepare textures nothing will ask for.
/// </para>
/// </remarks>
public sealed class Sprites
{
    private readonly GraphicsDevice _device;
    private readonly string _root;
    private readonly Dictionary<string, Texture2D?> _cache = new();

    /// <summary>A 1x1 white pixel, for solid fills - the letterbox, bars, flat colour.</summary>
    public Texture2D Blank { get; }

    public Sprites(GraphicsDevice device, string root)
    {
        _device = device;
        _root = root;
        Blank = new Texture2D(device, 1, 1);
        Blank.SetData(new[] { Microsoft.Xna.Framework.Color.White });
    }

    /// <summary>
    /// The texture for a sprite key, or null if there is no such file.
    /// </summary>
    /// <remarks>
    /// NULL RATHER THAN A THROW, and the caller skips what it cannot draw. A missing sprite should
    /// leave a hole in the picture, not take the window down - the simulation is unaffected either
    /// way, and a run that keeps playing is one you can still diagnose from.
    /// </remarks>
    public Texture2D? Get(string key)
    {
        if (_cache.TryGetValue(key, out var cached)) return cached;

        string path = Path.Combine(_root, key + ".png");
        Texture2D? tex = null;
        if (File.Exists(path))
        {
            using var stream = File.OpenRead(path);
            tex = Texture2D.FromStream(_device, stream);
        }
        _cache[key] = tex;
        return tex;
    }

    /// <summary>Where the sprites live, found by walking up from the binary to the repository.</summary>
    public static string FindRoot()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null)
        {
            string candidate = Path.Combine(dir.FullName, "public", "sprites");
            if (Directory.Exists(candidate)) return candidate;
            dir = dir.Parent;
        }
        return Path.Combine("public", "sprites");
    }
}
