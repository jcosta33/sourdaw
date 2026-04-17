/**
 * Typed errors for plugin / native-DSP hosting failures.
 *
 * These live in `engine/` (not `repositories/`) because the nodes themselves
 * throw them — callers in `useCases/buildDeviceChain.ts` can then catch on
 * type and route the user-facing response (notification, banner, bypass).
 *
 * Without a typed error, SharedArrayBuffer-related construction failures
 * propagate as generic `Error` objects indistinguishable from any other
 * device failure. The user sees silence and the device chain silently skips
 * the node.
 */

export class PluginRequiresIsolationError extends Error {
    readonly pluginName: string;

    constructor(pluginName: string, detail?: string) {
        const message = detail
            ? `${pluginName} requires cross-origin isolation (SharedArrayBuffer): ${detail}`
            : `${pluginName} requires cross-origin isolation (SharedArrayBuffer is not available). ` +
              'The server must send Cross-Origin-Opener-Policy: same-origin and ' +
              'Cross-Origin-Embedder-Policy: require-corp headers.';
        super(message);
        this.name = 'PluginRequiresIsolationError';
        this.pluginName = pluginName;
    }
}

export function isPluginRequiresIsolationError(err: unknown): err is PluginRequiresIsolationError {
    return err instanceof PluginRequiresIsolationError;
}

/**
 * Guard that every SharedArrayBuffer-dependent plugin entry point should call
 * as its first statement. Fails fast with a typed error — callers in
 * `buildDeviceChain` map the type to a user-visible notification and the
 * device chain routes around the missing node instead of silently skipping it.
 *
 * Without this guard, `telemetryAllocator`-backed nodes (Gluten, Proof,
 * Grinder, Bacteria, Scoring) throw a bare `ReferenceError: SharedArrayBuffer
 * is not defined` from `telemetryAllocator.ensureInit()`, which propagates as
 * an unhandled rejection — losing the plugin name and any chance of a
 * targeted UX response.
 */
export function requireSharedArrayBuffer(pluginName: string): void {
    if (typeof SharedArrayBuffer === 'undefined') {
        throw new PluginRequiresIsolationError(pluginName);
    }
}
