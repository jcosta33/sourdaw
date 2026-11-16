import { type AppAction } from '#/utils/handlerContract';

import { ACTION_LABELS } from './actionLabels';
import { getProjectMutationAdmissionFailure } from './getProjectMutationAdmissionFailure';
import { humanizeActionType } from './humanizeActionType';

/** The reason `executeAppAction` refused an action of `actionType`, worded for the person who triggered it. */
export function describeAppActionRefusal(actionType: AppAction['type']): string {
    const admissionFailure = getProjectMutationAdmissionFailure();
    if (admissionFailure) {
        return admissionFailure;
    }
    const label = ACTION_LABELS[actionType] ?? humanizeActionType(actionType);
    return `${label} was refused because the project can't be changed right now.`;
}
