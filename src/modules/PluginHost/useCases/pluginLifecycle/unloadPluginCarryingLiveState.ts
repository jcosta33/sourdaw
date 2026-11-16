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
    return scheduleKeyedUnload(instanceId, async () => {
        const reads = await readLiveStatesForTeardown([instanceId], 'inside-lifecycle');
        try {
            await unloadWithRetractedMirror(instanceId);
        } finally {
            commitCarriedLiveStates(reads, loadedExternalInstances.has(instanceId) ? [] : [instanceId]);
        }
    });
}
