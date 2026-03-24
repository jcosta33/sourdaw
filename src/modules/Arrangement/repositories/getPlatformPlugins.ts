import { BUILTIN_PLUGINS } from '#/modules/Arrangement/models/DeviceParameter';

/**
 * Returns the plugin list filtered for the current platform.
 * Native (Tauri) can run both web and native plugins.
 * Web can only run web-platform plugins.
 */
export function getPlatformPlugins(): typeof BUILTIN_PLUGINS {
    const isNative = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
    return BUILTIN_PLUGINS.filter((p) => {
        const platform = p.platform ?? 'both';
        if (platform === 'both') return true;
        if (isNative) return true;
        return platform === 'web';
    });
}
