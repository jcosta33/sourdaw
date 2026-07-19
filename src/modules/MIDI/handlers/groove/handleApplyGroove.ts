import { createHandler } from '#/utils/createHandler';
import { type AppAction } from '#/utils/handlerContract';

import { assignGrooveTemplate } from '../../useCases/grooveTemplates/assignGrooveTemplate';
import { canonicalizeGrooveTemplateAssignment } from '../../useCases/grooveTemplates/canonicalizeGrooveTemplateAssignment';
import { getGrooveAssignment } from '../../useCases/grooveTemplates/getGrooveAssignment';

type ApplyGrooveAction = Extract<AppAction, { type: 'applyGroove' }>;

function getAssignmentInput(action: ApplyGrooveAction) {
    return {
        consumerType: 'clip' as const,
        consumerId: action.payload.clipId,
        templateId: action.payload.grooveId,
        amount: action.payload.amount ?? 1,
    };
}

export const handleApplyGroove = createHandler<'applyGroove'>({
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
    },
    describe: (action) => {
        const expectedAssignment = canonicalizeGrooveTemplateAssignment(getAssignmentInput(action));
        return {
            label: `Assign groove "${action.payload.grooveId}"`,
            inverseAction: expectedAssignment
                ? {
                      type: 'restoreGrooveAssignment',
                      payload: {
                          consumerType: 'clip',
                          consumerId: action.payload.clipId,
                          assignment:
                              getGrooveAssignment({ consumerType: 'clip', consumerId: action.payload.clipId }) ?? null,
                          expectedAssignment,
                      },
                  }
                : null,
        };
    },
    undoable: true,
});
