import { agentProjectRepairStateStore } from '#/modules/CrdtDocument/stores';
import { type AppAction } from '#/utils/handlerContract';

import { isProjectDataRepairAction } from './isProjectDataRepairAction';

export const PROJECT_REPAIR_REQUIRED_MESSAGE = 'Project repair is required before project actions can execute';

/**
 * The one action the repair-required gate admits while it holds (issue #3573).
 *
 * Without an admitted route a user whose project tripped the gate can see why
 * edits are refused but cannot act: every action, including one that would fix
 * the document, is refused. The repair changes no musical content — it keeps the
 * value each conflicted field already resolved to and re-projects — so letting
 * it through cannot launder a mutation past the gate.
 */
export function isProjectMutationAllowed(action?: AppAction): boolean {
    if (action !== undefined && isProjectDataRepairAction(action)) {
        return true;
    }
    return agentProjectRepairStateStore.value === null;
}
