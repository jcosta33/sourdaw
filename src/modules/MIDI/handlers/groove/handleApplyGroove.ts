import { createHandler } from '#/utils/createHandler';
import { type AppAction, type HandlerValidationContext } from '#/utils/handlerContract';

import { assignGrooveTemplate } from '../../useCases/grooveTemplates/assignGrooveTemplate';
import { canonicalizeGrooveTemplateAssignment } from '../../useCases/grooveTemplates/canonicalizeGrooveTemplateAssignment';
import { getGrooveAssignment } from '../../useCases/grooveTemplates/getGrooveAssignment';
import { markGrooveTemplateProjectWrite } from '../../useCases/grooveTemplates/markGrooveTemplateProjectWrite';
import { planGrooveApplication } from '../../useCases/grooveTemplates/planGrooveApplication';

import { isApplyGrooveSessionEntry } from './validateApplyGrooveCommand';

type ApplyGrooveAction = Extract<AppAction, { type: 'applyGroove' }>;

function getAssignmentInput(action: ApplyGrooveAction) {
    return {
        consumerType: 'clip' as const,
        consumerId: action.payload.clipId,
        templateId: action.payload.grooveId,
        amount: action.payload.amount ?? 1,
    };
}

function planInBatch(action: ApplyGrooveAction, context?: HandlerValidationContext) {
    return planGrooveApplication(action.payload, context ? context.actions.slice(0, context.actionIndex) : []);
}

export const handleApplyGroove = createHandler<'applyGroove'>({
    validateSessionEntry: isApplyGrooveSessionEntry,
    validate: (action, context) => planInBatch(action, context).refusal === null,
    validationRefusalReason: (action, context) => planInBatch(action, context).refusal,
    isNoop: (action) => {
        const expected = canonicalizeGrooveTemplateAssignment(getAssignmentInput(action));
        const current = getGrooveAssignment(getAssignmentInput(action));
        return (
            expected !== null &&
            current?.consumerType === expected.consumerType &&
            current.consumerId === expected.consumerId &&
            current.templateId === expected.templateId &&
            current.amount === expected.amount
        );
    },
    execute: (action) => {
        const result = assignGrooveTemplate(getAssignmentInput(action));
        if (!result.ok) {
            throw new Error(`Groove assignment rejected: ${result.error.code}`);
        }
        if (result.status === 'no-write') {
            return { status: 'no-write' };
        }
        return {
            status: 'written',
            afterCommit: markGrooveTemplateProjectWrite,
            afterAmbiguousCommit: markGrooveTemplateProjectWrite,
        };
    },
    describe: (action, context) => {
        // The assignment this application replaces is the one the earlier actions of its batch leave.
        const { assignment, priorAssignment } = planInBatch(action, context);
        return {
            label: `Assign groove "${action.payload.grooveId}"`,
            inverseAction: assignment
                ? {
                      type: 'restoreGrooveAssignment',
                      payload: {
                          consumerType: 'clip',
                          consumerId: assignment.consumerId,
                          assignment: priorAssignment,
                          expectedAssignment: assignment,
                      },
                  }
                : null,
        };
    },
    undoable: true,
});
