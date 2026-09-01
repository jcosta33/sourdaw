import { unloadPlugin as unloadPluginRepo } from '../../repositories/pluginBridge/unloadPlugin';
import {
    defaultExternalPluginActivationState,
    externalPluginActivationStore,
} from '../../stores/externalPluginActivationStore';
import { dropExternalPluginParameterSnapshot } from '../../stores/externalPluginParameterStore';
import { defaultPluginGuiState, pluginGuiStore } from '../../stores/pluginGuiStore';

import { externalLatencyReporters } from './externalLatencyReporters';
import { externalPluginActivationOutcomes, externalPluginActivationTasks } from './externalPluginActivationTasks';
import { loadedExternalInstances } from './loadedExternalInstances';
import { serializePluginLifecycle } from './serializePluginLifecycle';

function forgetPluginInstance(instanceId: string): void {
    loadedExternalInstances.delete(instanceId);
    externalLatencyReporters.delete(instanceId);
    externalPluginActivationTasks.delete(instanceId);
    externalPluginActivationOutcomes.delete(instanceId);
    // The parameters described an instance that no longer exists; leaving them
    // would keep offering automation targets for a destroyed plugin.
    dropExternalPluginParameterSnapshot(instanceId);
    externalPluginActivationStore.update((state) => {
        const byInstanceId = { ...(state ?? defaultExternalPluginActivationState).byInstanceId };
        delete byInstanceId[instanceId];
        return { ...(state ?? defaultExternalPluginActivationState), byInstanceId };
    });
    // Unloading destroys the editor window without the OS reporting a close, so
    // nothing else will ever retract an `isOpen` left standing here.
    pluginGuiStore.update((state) => {
        const byInstanceId = { ...(state ?? defaultPluginGuiState).byInstanceId };
        delete byInstanceId[instanceId];
        return { ...(state ?? defaultPluginGuiState), byInstanceId };
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
