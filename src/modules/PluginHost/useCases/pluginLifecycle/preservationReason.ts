import { externalPluginActivationTasks } from './externalPluginActivationTasks';
import { externalPluginRestoreFailures } from './externalPluginRestoreFailures';
import { loadedExternalInstances } from './loadedExternalInstances';

/** Why an instance's live state must not stand in for its project chunk right now, or null when it may. */
export function preservationReason(instanceId: string): 'restore-failed' | 'restore-pending' | 'not-loaded' | null {
    if (externalPluginRestoreFailures.has(instanceId)) {
        return 'restore-failed';
    }
    if (externalPluginActivationTasks.has(instanceId)) {
        return 'restore-pending';
    }
    if (!loadedExternalInstances.has(instanceId)) {
        return 'not-loaded';
    }
    return null;
}
