import {
    defaultExternalPluginActivationState,
    externalPluginActivationStore,
} from '../../stores/externalPluginActivationStore';
import {
    defaultExternalPluginParameterState,
    externalPluginParameterStore,
} from '../../stores/externalPluginParameterStore';

import { externalLatencyReporters } from './externalLatencyReporters';
import {
    externalPluginActivationEpoch,
    externalPluginActivationOutcomes,
    externalPluginActivationTasks,
} from './externalPluginActivationTasks';
import { loadedExternalInstances } from './loadedExternalInstances';

/**
 * Drop every live-instance activation guard. Called when the audio graph is torn
 * down (project open/switch), so the next generation re-activates the incoming
 * project's persisted native plugins instead of treating them as already live.
 *
 * The latency and bridge-cost sinks go with them: they close over the outgoing
 * project's device ids, so keeping them would route the next generation's
 * pushes into a registry entry for a device that no longer exists.
 */
export function clearLoadedExternalPlugins(): void {
    loadedExternalInstances.clear();
    externalLatencyReporters.clear();
    externalPluginActivationEpoch.current += 1;
    externalPluginActivationTasks.clear();
    externalPluginActivationOutcomes.clear();
    externalPluginActivationStore.set(defaultExternalPluginActivationState);
    // The parameter snapshots belong to the outgoing generation's instances.
    externalPluginParameterStore.set(defaultExternalPluginParameterState);
}
