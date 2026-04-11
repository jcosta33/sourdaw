import { unloadPlugin as unloadPluginRepo } from '../../repositories/pluginBridge/unloadPlugin';

/** Unload a plugin instance by its instance ID. */
export function unloadPlugin(instanceId: string): ReturnType<typeof unloadPluginRepo> {
    return unloadPluginRepo(instanceId);
}