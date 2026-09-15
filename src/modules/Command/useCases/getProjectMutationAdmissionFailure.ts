import { agentProjectRepairStateStore } from '#/modules/CrdtDocument/stores';
import { type AppAction } from '#/utils/handlerContract';

import { isProjectDataRepairAction } from './isProjectDataRepairAction';
/**
 * Why a project mutation is currently refused, or `null` when it is admitted.
 *
 * Pass the action being dispatched: the user's project-data repair is admitted
 * while the gate it repairs holds. Callers with no action at hand (undo, batch
 * preflight, refusal copy) keep the strict reading.
 */
export function getProjectMutationAdmissionFailure(action?: AppAction): string | null {
    if (action !== undefined && isProjectDataRepairAction(action)) {
        return null;
    }
    return agentProjectRepairStateStore.value === null
        ? null
        : 'Project repair is required before project actions can execute';
}
