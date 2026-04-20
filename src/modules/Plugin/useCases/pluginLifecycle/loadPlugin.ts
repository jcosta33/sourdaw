import { loadPlugin as loadPluginRepo } from '../../repositories/pluginBridge/loadPlugin';

/** Load a plugin instance by plugin ID and instance ID. */
export function loadPlugin(pluginId: string, instanceId: string): ReturnType<typeof loadPluginRepo> {
    return loadPluginRepo(pluginId, instanceId);
}
