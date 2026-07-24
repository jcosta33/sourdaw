import { unloadPlugin as unloadPluginRepo } from '../../repositories/pluginBridge/unloadPlugin';

import { loadedExternalInstances } from './loadedExternalInstances';
import { serializePluginLifecycle } from './serializePluginLifecycle';

/** Unload a plugin instance by its instance ID. */
export function unloadPlugin(instanceId: string): ReturnType<typeof unloadPluginRepo> {
    loadedExternalInstances.delete(instanceId);
    return serializePluginLifecycle(instanceId, () => unloadPluginRepo(instanceId));
}
