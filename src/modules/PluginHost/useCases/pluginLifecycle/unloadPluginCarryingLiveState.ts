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
        let refusedAfterLetGo = false;
        try {
            await unloadWithRetractedMirror(instanceId, wasLetGo);
        } catch (error) {
            refusedAfterLetGo = wasLetGo();
            throw error;
        } finally {
            // A let-go unload no longer decides `loadedExternalInstances` (the rebuild emptied it and the id may
            // be live again), so its refusal is the evidence the instance survived. A later activation of the id
            // moved its carry slot, so the commit discards the read it overtook.
            const survived = refusedAfterLetGo || loadedExternalInstances.has(instanceId);
            commitCarriedLiveStates(reads, survived ? [] : [instanceId]);
        }
    });
}
