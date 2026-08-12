import { unloadPlugin as unloadPluginRepo } from '../../repositories/pluginBridge/unloadPlugin';
import {
    defaultExternalPluginActivationState,
    externalPluginActivationStore,
} from '../../stores/externalPluginActivationStore';

import { externalLatencyReporters } from './externalLatencyReporters';
import { loadedExternalInstances } from './loadedExternalInstances';
import { serializePluginLifecycle } from './serializePluginLifecycle';

function forgetPluginInstance(instanceId: string): void {
    loadedExternalInstances.delete(instanceId);
    externalLatencyReporters.delete(instanceId);
    externalPluginActivationStore.update((state) => {
        const byInstanceId = { ...(state ?? defaultExternalPluginActivationState).byInstanceId };
        delete byInstanceId[instanceId];
        return { ...(state ?? defaultExternalPluginActivationState), byInstanceId };
    });
}

function reconcileUnloadResult(
    result: Awaited<ReturnType<typeof unloadPluginRepo>>,
    expectedInstanceId?: string
): void {
    const mismatchedSuccess = expectedInstanceId !== undefined && result[0].some((id) => id !== expectedInstanceId);
    const missingOutcome = expectedInstanceId !== undefined && result[0].length === 0 && result[1].length === 0;
    if (mismatchedSuccess || missingOutcome) {
        throw new Error('Invalid keyed unload_plugin response');
    }
    for (const instanceId of result[0]) {
        forgetPluginInstance(instanceId);
    }
    if (result[1].length > 0) {
        throw new Error(result[1].join('; '));
    }
}

export function unloadPlugin(instanceId?: string): Promise<void> {
    if (instanceId === undefined) {
        return unloadPluginRepo().then(reconcileUnloadResult);
    }
    return serializePluginLifecycle(instanceId, async () => {
        if (!loadedExternalInstances.has(instanceId)) {
            return;
        }
        reconcileUnloadResult(await unloadPluginRepo(instanceId), instanceId);
    });
}
