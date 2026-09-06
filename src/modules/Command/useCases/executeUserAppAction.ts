import { type AppAction } from '#/utils/handlerContract';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { AppActionConflictError } from '../errors/AppActionExecutionError';

import { ACTION_LABELS } from './actionLabels';
import { executeAppAction, type ExecuteAppActionOptions } from './executeAppAction';
import { humanizeActionType } from './humanizeActionType';
import { getProjectMutationAdmissionFailure } from './isProjectMutationAllowed';

function describeRefusal(action: AppAction): string {
    const admissionFailure = getProjectMutationAdmissionFailure();
    if (admissionFailure) {
        return admissionFailure;
    }
    const label = ACTION_LABELS[action.type] ?? humanizeActionType(action.type);
    return `${label} was refused because the project can't be changed right now.`;
}

/**
 * Dispatch entry point for actions a person triggered from the UI.
 *
 * `executeAppAction` refuses a mutation on a repair-required or brief-locked
 * project by rejecting, and every UI caller drops that promise on the floor, so
 * the refusal reached the user as nothing but an unhandled rejection. Here the
 * refusal becomes a warning notification and the promise resolves; every other
 * failure still propagates to the caller unchanged.
 */
export async function executeUserAppAction(action: AppAction, options?: ExecuteAppActionOptions): Promise<void> {
    try {
        await executeAppAction(action, options);
    } catch (error) {
        if (!(error instanceof AppActionConflictError)) {
            throw error;
        }
        notifyUser(describeRefusal(action), 'warning');
    }
}
