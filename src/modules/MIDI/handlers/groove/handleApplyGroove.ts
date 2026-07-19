import { createHandler } from '#/utils/createHandler';

import { assignGrooveTemplate } from '../../useCases/grooveTemplates/assignGrooveTemplate';
import { canonicalizeGrooveTemplateAssignment } from '../../useCases/grooveTemplates/canonicalizeGrooveTemplateAssignment';
import { getGrooveAssignment } from '../../useCases/grooveTemplates/getGrooveAssignment';

export const handleApplyGroove = createHandler<'applyGroove'>({
    execute: (action) => {
        const result = assignGrooveTemplate({
            consumerType: 'clip',
            consumerId: action.payload.clipId,
            templateId: action.payload.grooveId,
            amount: action.payload.amount ?? 1,
        });
        if (!result.ok) {
            throw new Error(`Groove assignment rejected: ${result.error.code}`);
        }
    },
    describe: (action) => {
        const expectedAssignment = canonicalizeGrooveTemplateAssignment({
            consumerType: 'clip',
            consumerId: action.payload.clipId,
            templateId: action.payload.grooveId,
            amount: action.payload.amount ?? 1,
        });
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
