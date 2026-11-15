import { createHandler } from '#/utils/createHandler';
import { type AppAction, type HandlerValidationContext } from '#/utils/handlerContract';
import { valuesEqual } from '#/utils/structuralEquality';

import { grooveTemplateStore } from '../../stores/grooveTemplateStore';
import { getGrooveAssignment } from '../../useCases/grooveTemplates/getGrooveAssignment';
import { markGrooveTemplateProjectWrite } from '../../useCases/grooveTemplates/markGrooveTemplateProjectWrite';
import { projectGrooveTemplateState } from '../../useCases/grooveTemplates/projectGrooveTemplateState';
import { restoreGrooveAssignment } from '../../useCases/grooveTemplates/restoreGrooveAssignment';

type RestoreGrooveAssignmentAction = Extract<AppAction, { type: 'restoreGrooveAssignment' }>;

/**
 * Why a guarded restore (an undo) must not run against the assignments its batch's earlier actions
 * leave, or null when it may: an assignment changed since the action it undoes is a later edit the
 * undo must not overwrite.
 */
function findRestoreConflict(action: RestoreGrooveAssignmentAction, context: HandlerValidationContext): string | null {
    const { consumerType, consumerId, expectedAssignment } = action.payload;
    if (expectedAssignment === undefined) {
        return null;
    }
    const liveState = grooveTemplateStore.value;
    if (!liveState) {
        return 'The groove pool is unavailable';
    }
    const state = projectGrooveTemplateState(liveState, context.actions.slice(0, context.actionIndex));
    const current = getGrooveAssignment({ consumerType, consumerId }, state) ?? null;
    return valuesEqual(current, expectedAssignment)
        ? null
        : `The groove assignment of ${consumerType} "${consumerId}" changed after the edit this restores`;
}

export const handleRestoreGrooveAssignment = createHandler<'restoreGrooveAssignment'>({
    validate: (action, context) => findRestoreConflict(action, context) === null,
    validationRefusalReason: findRestoreConflict,
    // Only a restore guarded by the assignment it expects can be replayed after divergence.
    canReapplyAfterDivergence: (action) => action.payload.expectedAssignment !== undefined,
    execute: (action) => {
        const result = restoreGrooveAssignment(action.payload);
        if (result.status === 'no-write') {
            return { status: 'no-write' };
        }
        return {
            status: 'written',
            afterCommit: markGrooveTemplateProjectWrite,
            afterAmbiguousCommit: markGrooveTemplateProjectWrite,
        };
    },
    describe: () => ({ label: 'Restore groove assignment' }),
    undoable: false,
});
