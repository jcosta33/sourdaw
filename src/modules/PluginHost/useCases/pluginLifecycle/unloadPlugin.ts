import { unloadPlugin as unloadPluginRepo } from '../../repositories/pluginBridge/unloadPlugin';

import { externalLatencyReporters } from './externalLatencyReporters';
import { loadedExternalInstances } from './loadedExternalInstances';
import { serializePluginLifecycle } from './serializePluginLifecycle';

/** Unload a plugin instance by its instance ID. */
export function unloadPlugin(instanceId: string): ReturnType<typeof unloadPluginRepo> {
    loadedExternalInstances.delete(instanceId);
    // The instance stops processing, so its latency sink must stop receiving —
    // a late push must not revive compensation for an unloaded plugin.
    externalLatencyReporters.delete(instanceId);
    return serializePluginLifecycle(instanceId, () => unloadPluginRepo(instanceId));
}
