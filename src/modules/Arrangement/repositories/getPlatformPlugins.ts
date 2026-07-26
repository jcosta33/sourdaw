import { BUILTIN_PLUGINS, isDeviceSupportedOnCurrentPlatform } from '../models/DeviceParameter';

/**
 * The plugin list the Content Browser, the mixer device menu and `addDevice`
 * offer on the runtime this build is actually executing on.
 *
 * This used to drop every `platform: 'native'` entry unconditionally, with no
 * runtime check — the opposite of what `isDeviceSupportedOnCurrentPlatform`
 * next to it already documented ("native can run both web and native plugins").
 * Under that filter, marking a device native-only removed it from the native
 * build as well, which is the one runtime where its engine exists. Nothing
 * exercised the difference because no descriptor was native-only yet.
 */
export function getPlatformPlugins(): typeof BUILTIN_PLUGINS {
    return BUILTIN_PLUGINS.filter((plugin) => isDeviceSupportedOnCurrentPlatform(plugin.id));
}
