import { loadPlugin as loadPluginRepo } from '../../repositories/pluginBridge/loadPlugin';

import { serializePluginLifecycle } from './serializePluginLifecycle';

/**
 * Load a plugin instance by plugin ID and instance ID, at the sample rate of
 * the engine that will feed it audio.
 */
export function loadPlugin(
    pluginId: string,
    instanceId: string,
    sampleRate: number
): ReturnType<typeof loadPluginRepo> {
    return serializePluginLifecycle(instanceId, () => loadPluginRepo(pluginId, instanceId, sampleRate));
}
