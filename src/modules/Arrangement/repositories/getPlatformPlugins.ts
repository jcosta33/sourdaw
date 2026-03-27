import { BUILTIN_PLUGINS } from '#/modules/Arrangement/models/DeviceParameter';

/**
 * Web effects that have native (WASM DSP) equivalents.
 * On native (Tauri), the web versions are hidden in favor of native.
 */
const WEB_TO_NATIVE_MAP: Record<string, string> = {
    'builtin-eq': 'native-eq',
    'builtin-compressor': 'native-compressor',
    'builtin-limiter': 'native-limiter',
    'builtin-reverb': 'native-reverb',
    'builtin-delay': 'native-delay',
    'builtin-gate': 'native-gate',
    'builtin-gain': 'native-gain',
};

const webIdsWithNativeEquivalent = new Set(Object.keys(WEB_TO_NATIVE_MAP));

/**
 * Returns the plugin list filtered for the current platform.
 *
 * Native (Tauri): Shows native effects instead of web duplicates.
 * Web: Shows only web-platform plugins (native-* hidden).
 */
export function getPlatformPlugins(): typeof BUILTIN_PLUGINS {
    const isNative = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

    return BUILTIN_PLUGINS.filter((p) => {
        const platform = p.platform ?? 'both';

        if (!isNative) {
            // Web: hide native-only plugins
            return platform !== 'native';
        }

        // Native: hide web effects that have native equivalents
        if (webIdsWithNativeEquivalent.has(p.id)) {
            return false;
        }

        return true;
    });
}
