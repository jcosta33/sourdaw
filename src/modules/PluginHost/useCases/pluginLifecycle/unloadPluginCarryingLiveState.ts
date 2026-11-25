import { commitCarriedLiveStates } from './commitCarriedLiveStates';
import { loadedExternalInstances } from './loadedExternalInstances';
import { readLiveStatesForTeardown } from './readLiveStatesForTeardown';
import { scheduleKeyedUnload } from './scheduleKeyedUnload';
import { unloadWithRetractedMirror } from './unloadWithRetractedMirror';

/**
 * Unload one instance the app will reactivate later — a removed device that
 * Undo restores, or a sibling a strip deactivation takes down — carrying its
 * live state to that reactivation. Other teardowns use `unloadPlugin`.
 */
export function unloadPluginCarryingLiveState(instanceId: string): Promise<void> {
    return scheduleKeyedUnload(instanceId, async (wasLetGo) => {
        const reads = await readLiveStatesForTeardown([instanceId], 'inside-lifecycle');
        try {
            await unloadWithRetractedMirror(instanceId, wasLetGo);
        } finally {
            // A let-go read is the old generation's; the id may be live again.
            if (!wasLetGo()) {
                commitCarriedLiveStates(reads, loadedExternalInstances.has(instanceId) ? [] : [instanceId]);
            }
        }
    });
}
