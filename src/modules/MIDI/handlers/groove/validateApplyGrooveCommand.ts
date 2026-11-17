import { type HandlerSessionActionEntry } from '#/utils/handlerContract';
import { valuesEqual } from '#/utils/structuralEquality';

import { isGrooveTemplateAssignment } from '../../models/GrooveTemplateState';
import { canonicalizeGrooveTemplateAssignment } from '../../useCases/grooveTemplates/canonicalizeGrooveTemplateAssignment';

/**
 * A saved groove application is replayable only when its undo restores one clip assignment (or
 * none) for the clip it assigned, guarded by exactly the assignment the application wrote, so the
 * undo refuses rather than overwrite an assignment changed since; its redo re-runs the application.
 */
export function isApplyGrooveSessionEntry(entry: HandlerSessionActionEntry): boolean {
    const { action, inverseAction, redoAction } = entry;
    if (
        action.type !== 'applyGroove' ||
        redoAction !== undefined ||
        inverseAction?.type !== 'restoreGrooveAssignment'
    ) {
        return false;
    }
    const written = canonicalizeGrooveTemplateAssignment({
        consumerType: 'clip',
        consumerId: action.payload.clipId,
        templateId: action.payload.grooveId,
        amount: action.payload.amount ?? 1,
    });
    const { consumerType, consumerId, assignment, expectedAssignment } = inverseAction.payload;
    return (
        written !== null &&
        consumerType === 'clip' &&
        consumerId === written.consumerId &&
        valuesEqual(expectedAssignment, written) &&
        (assignment === null ||
            (isGrooveTemplateAssignment(assignment) &&
                assignment.consumerType === 'clip' &&
                assignment.consumerId === written.consumerId))
    );
}
