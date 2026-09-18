import { loadPlugin as loadPluginRepo } from '../../repositories/pluginBridge/loadPlugin';

import { externalPluginStateCaptureAuthority } from './externalPluginStateCaptureAuthority';
import { serializePluginLifecycle } from './serializePluginLifecycle';

/**
 * Load a plugin instance by plugin ID and instance ID. The native engine
 * activates it at its own negotiated rate; this call supplies none.
 */
export function loadPlugin(pluginId: string, instanceId: string): ReturnType<typeof loadPluginRepo> {
    externalPluginStateCaptureAuthority.invalidate(instanceId);
    return serializePluginLifecycle(instanceId, () => loadPluginRepo(pluginId, instanceId));
}
