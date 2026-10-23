import { logger } from '#/infra/logger/appLogger';
import { flushAutomergeStorageWrites } from '#/infra/store/storage/createAutomergeStorage';
import { executeAppAction, isAppActionConflictError } from '#/modules/Command/useCases';
import { agentProjectRepairStateStore } from '#/modules/CrdtDocument/stores';
import { isTransportIdle, stopPlayback } from '#/modules/Transport/useCases';
import { notifyUser } from '#/utils/Notification/notifyUser';

export type RepairProjectDataOutcome = 'nothing-to-repair' | 'repaired' | 'refused';

/**
 * The banner's repair button (issue #3573): dispatch the project-data repair
 * the admission gate admits while it holds, and report the outcome.
 *
 * This mirrors `executeUserAppAction`'s refusal handling rather than routing
 * through it, because the outcome is this route's own contract: the caller
 * learns whether the gate came down, and the notifications name the repair
 * specifically instead of the generic refusal text.
 */
export async function repairProjectData(): Promise<RepairProjectDataOutcome> {
    if (agentProjectRepairStateStore.value === null) {
        return 'nothing-to-repair';
    }
    // The repair re-projects every store, and the projection releases a write a
    // store still holds unflushed. A take closed by Stop is exactly such a
    // write, so Stop has to land the take's commit before the repair runs; the
    // handler refuses a transport that is not idle by then. This is a plain
    // Stop, so it keeps a plain Stop's outcome under the gate this repair
    // lifts: the gate refuses the take's commit and Stop retires the take.
    try {
        await stopPlayback();
    } catch (error) {
        // A take whose stop failed has not landed, and the repair would release it.
        logger.warn(new Error('Transport stop failed before the project repair', { cause: error }));
        notifyUser('Playback could not be stopped - stop it and repair again', 'warning');
        return 'refused';
    }
    // That retirement is a store write too; land it before the projection can
    // release it and bring back a half-recorded take no history entry owns.
    flushAutomergeStorageWrites();
    try {
        await executeAppAction({ type: 'repairProjectData' }, { source: 'manual' });
    } catch (error) {
        if (isAppActionConflictError(error)) {
            notifyUser(
                isTransportIdle()
                    ? 'The repair could not clear the problem - ask the assistant to repair the project'
                    : 'Playback started during the repair - stop it and repair again',
                'warning'
            );
            return 'refused';
        }
        throw error;
    }
    notifyUser('Project repaired - editing and saving are re-enabled', 'success');
    return 'repaired';
}
