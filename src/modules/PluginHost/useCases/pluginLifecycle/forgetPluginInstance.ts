/**
 * Drop everything this process recorded about one external plugin instance.
 *
 * Shared by `unloadPlugin.ts`, which forgets an instance the native host
 * retired on request, and `forgetRetiredPluginInstances.ts`, which forgets the
 * ones an engine retire destroyed without being asked.
 */

import {
    defaultExternalPluginActivationState,
    externalPluginActivationStore,
} from '../../stores/externalPluginActivationStore';
import { dropExternalPluginParameterSnapshot } from '../../stores/externalPluginParameterStore';
import { defaultPluginGuiState, pluginGuiStore } from '../../stores/pluginGuiStore';

import { externalLatencyReporters } from './externalLatencyReporters';
import { externalPluginActivationOutcomes, externalPluginActivationTasks } from './externalPluginActivationTasks';
import { loadedExternalInstances } from './loadedExternalInstances';

export function forgetPluginInstance(instanceId: string): void {
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
