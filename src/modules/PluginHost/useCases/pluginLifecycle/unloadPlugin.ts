import { unloadPlugin as unloadPluginRepo } from '../../repositories/pluginBridge/unloadPlugin';
import {
    defaultExternalPluginActivationState,
    externalPluginActivationStore,
} from '../../stores/externalPluginActivationStore';

import { externalLatencyReporters } from './externalLatencyReporters';
import { loadedExternalInstances } from './loadedExternalInstances';
import { serializePluginLifecycle } from './serializePluginLifecycle';

/** Unload a plugin instance by its instance ID. */
export function unloadPlugin(instanceId: string): ReturnType<typeof unloadPluginRepo> {
    return serializePluginLifecycle(instanceId, async () => {
        if (!loadedExternalInstances.has(instanceId)) {
            return;
        }
        await unloadPluginRepo(instanceId);
        loadedExternalInstances.delete(instanceId);
        externalPluginActivationStore.update((state) => {
            const current = state ?? defaultExternalPluginActivationState;
            const byInstanceId = { ...current.byInstanceId };
            delete byInstanceId[instanceId];
            return { ...current, byInstanceId };
        });
        externalLatencyReporters.delete(instanceId);
    });
}
