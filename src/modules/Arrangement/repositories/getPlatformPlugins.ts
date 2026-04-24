import { BUILTIN_PLUGINS } from '../models/DeviceParameter';

/**
 * Returns the plugin list for the current platform.
 * All plugins are available on both web and native (Tauri).
 */
export function getPlatformPlugins(): typeof BUILTIN_PLUGINS {
    return BUILTIN_PLUGINS.filter((param) => {
        const platform = param.platform ?? 'both';
        return platform !== 'native';
    });
}
