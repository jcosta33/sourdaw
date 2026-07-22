import { unloadPlugin as unloadPluginRepo } from '../../repositories/pluginBridge/unloadPlugin';

import { serializePluginLifecycle } from './serializePluginLifecycle';

/** Unload a plugin instance by its instance ID. */
export function unloadPlugin(instanceId: string): ReturnType<typeof unloadPluginRepo> {
    return serializePluginLifecycle(instanceId, () => unloadPluginRepo(instanceId));
}
