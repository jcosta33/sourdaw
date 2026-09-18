import { executeAppAction, isAppActionConflictError } from '#/modules/Command/useCases';
import { agentProjectRepairStateStore } from '#/modules/CrdtDocument/stores';
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
    try {
        await executeAppAction({ type: 'repairProjectData' }, { source: 'manual' });
    } catch (error) {
        if (isAppActionConflictError(error)) {
            notifyUser('The repair could not clear the problem - ask the assistant to repair the project', 'warning');
            return 'refused';
        }
        throw error;
    }
    notifyUser('Project repaired - editing and saving are re-enabled', 'success');
    return 'repaired';
}
