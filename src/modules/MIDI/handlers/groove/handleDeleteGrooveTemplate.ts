import { createHandler } from '#/utils/createHandler';
import { type AppAction } from '#/utils/handlerContract';
import { valuesEqual } from '#/utils/structuralEquality';

import { deleteGrooveTemplate } from '../../useCases/grooveTemplates/deleteGrooveTemplate';
import { markGrooveTemplateProjectWrite } from '../../useCases/grooveTemplates/markGrooveTemplateProjectWrite';
import { snapshotGrooveTemplateDeletion } from '../../useCases/grooveTemplates/snapshotGrooveTemplateDeletion';

type DeleteGrooveTemplatePayload = Extract<AppAction, { type: 'deleteGrooveTemplate' }>['payload'];

/**
 * Why a guarded delete (the inverse of an extraction) must not run, or null when it may. Deleting a
 * template resets every assignment to straight, so undoing an extraction that a later assignment
 * uses would silently undo that later edit too; a template renamed or replaced since is no longer
 * the one the extraction created.
 */
function findGuardedDeleteConflict(payload: DeleteGrooveTemplatePayload): string | null {
    if (payload.expectedTemplate === undefined) {
        return null;
    }
    const snapshot = snapshotGrooveTemplateDeletion(payload.templateId);
    if (snapshot === null) {
        return `Groove template "${payload.templateId}" is no longer in the project`;
    }
    if (!valuesEqual(snapshot.template, payload.expectedTemplate)) {
        return `Groove template "${payload.templateId}" changed after it was extracted`;
    }
    if (snapshot.assignments.length > 0) {
        return `Groove template "${payload.templateId}" is assigned to ${String(snapshot.assignments.length)} consumer(s) since it was extracted`;
    }
    return null;
}

export const handleDeleteGrooveTemplate = createHandler<'deleteGrooveTemplate'>({
    isNoop: (action) =>
        action.payload.expectedTemplate === undefined &&
        snapshotGrooveTemplateDeletion(action.payload.templateId) === null,
    execute: (action) => {
        const conflict = findGuardedDeleteConflict(action.payload);
        if (conflict !== null) {
            return { status: 'conflict', reason: conflict };
        }
        const snapshot = deleteGrooveTemplate(action.payload.templateId);
        if (!snapshot) {
            return { status: 'no-write' };
        }
        return {
            status: 'written',
            afterCommit: markGrooveTemplateProjectWrite,
            afterAmbiguousCommit: markGrooveTemplateProjectWrite,
        };
    },
    describe: (action) => {
        const snapshot = snapshotGrooveTemplateDeletion(action.payload.templateId);
        return {
            label: 'Delete groove template',
            inverseAction: snapshot ? { type: 'restoreDeletedGrooveTemplate', payload: snapshot } : null,
        };
    },
    undoable: true,
});
