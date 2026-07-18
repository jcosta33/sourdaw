/**
 * Plugin loader registry — id-prefix → audio-node loader.
 *
 * Inverts control between the format-agnostic WAM host and format-specific
 * loaders (Faust, future formats). Each plugin source registers its loader
 * at module init; `wamPluginHost.loadWAMPlugin` consults this registry
 * instead of branching on hard-coded id prefixes. Breaks the
 * `hostOperations` ↔ `compilerEngine` cycle by removing the back-edge from
 * the host into the Faust compiler.
 *
 * Module-private singleton — matches the existing pattern in
 * `wamPluginHost/hostOperations.ts` (line 4) which uses raw `Map`s for its
 * registry/instances state.
 */

export type PluginAudioNodeLoader = (pluginId: string, context: AudioContext) => Promise<AudioNode | null>;

const loaders = new Map<string, PluginAudioNodeLoader>();

/** Register a loader for plugin ids that start with `idPrefix`. */
export function registerPluginLoader(idPrefix: string, loader: PluginAudioNodeLoader): void {
    loaders.set(idPrefix, loader);
}

/** Find the loader whose prefix matches `pluginId`. Returns null if none. */
export function findPluginLoader(pluginId: string): PluginAudioNodeLoader | null {
    for (const [prefix, loader] of loaders) {
        if (pluginId.startsWith(prefix)) {
            return loader;
        }
    }
    return null;
}
