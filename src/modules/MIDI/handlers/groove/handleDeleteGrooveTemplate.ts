import { createHandler } from '#/utils/createHandler';
import { type AppAction, type HandlerValidationContext } from '#/utils/handlerContract';
import { valuesEqual } from '#/utils/structuralEquality';

import { grooveTemplateStore } from '../../stores/grooveTemplateStore';
import { deleteGrooveTemplate } from '../../useCases/grooveTemplates/deleteGrooveTemplate';
import { markGrooveTemplateProjectWrite } from '../../useCases/grooveTemplates/markGrooveTemplateProjectWrite';
import { projectGrooveTemplateState } from '../../useCases/grooveTemplates/projectGrooveTemplateState';
import { snapshotGrooveTemplateDeletion } from '../../useCases/grooveTemplates/snapshotGrooveTemplateDeletion';

type DeleteGrooveTemplatePayload = Extract<AppAction, { type: 'deleteGrooveTemplate' }>['payload'];

/**
 * Why a guarded delete (the inverse of an extraction) must not run, or null when it may. Deleting a
 * template resets every assignment to straight, so undoing an extraction that a later assignment
 * uses would silently undo that later edit too; a template renamed or replaced since is no longer
 * the one the extraction created.
 */
function findGuardedDeleteConflict(
    payload: DeleteGrooveTemplatePayload,
    state = grooveTemplateStore.value
): string | null {
    if (payload.expectedTemplate === undefined) {
        return null;
    }
    // A template already gone leaves the extraction undone, so there is nothing to refuse.
    const snapshot = snapshotGrooveTemplateDeletion(payload.templateId, state);
    if (snapshot === null) {
        return null;
    }
    if (!valuesEqual(snapshot.template, payload.expectedTemplate)) {
        return `Groove template "${payload.templateId}" changed after it was extracted`;
    }
    if (snapshot.assignments.length > 0) {
        return `Groove template "${payload.templateId}" is assigned to ${String(snapshot.assignments.length)} consumer(s) since it was extracted`;
    }
    return null;
}

/** The guarded-delete conflict against the groove pool as the earlier actions of its batch leave it. */
function findBatchDeleteConflict(
    action: Extract<AppAction, { type: 'deleteGrooveTemplate' }>,
    context: HandlerValidationContext
): string | null {
    const liveState = grooveTemplateStore.value;
    if (!liveState) {
        return null;
    }
    const state = projectGrooveTemplateState(liveState, context.actions.slice(0, context.actionIndex));
    return findGuardedDeleteConflict(action.payload, state);
}

export const handleDeleteGrooveTemplate = createHandler<'deleteGrooveTemplate'>({
    validate: (action, context) => findBatchDeleteConflict(action, context) === null,
    validationRefusalReason: findBatchDeleteConflict,
    // Only the guarded delete (an extraction's undo) states the template it expects to remove.
    canReapplyAfterDivergence: (action) => action.payload.expectedTemplate !== undefined,
    isNoop: (action) => snapshotGrooveTemplateDeletion(action.payload.templateId) === null,
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
