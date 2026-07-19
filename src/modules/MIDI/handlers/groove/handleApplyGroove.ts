import { createHandler } from '#/utils/createHandler';

import { assignGrooveTemplate } from '../../useCases/grooveTemplates/assignGrooveTemplate';
import { getGrooveAssignment } from '../../useCases/grooveTemplates/getGrooveAssignment';

export const handleApplyGroove = createHandler<'applyGroove'>({
    execute: (action) => {
        assignGrooveTemplate({
            consumerType: 'clip',
            consumerId: action.payload.clipId,
            templateId: action.payload.grooveId,
            amount: action.payload.amount ?? 1,
        });
    },
    describe: (action) => ({
        label: `Assign groove "${action.payload.grooveId}"`,
        inverseAction: {
            type: 'restoreGrooveAssignment',
            payload: {
                consumerType: 'clip',
                consumerId: action.payload.clipId,
                assignment: getGrooveAssignment({ consumerType: 'clip', consumerId: action.payload.clipId }) ?? null,
            },
        },
    }),
    undoable: true,
});
