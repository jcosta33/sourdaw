import { createHandler } from '#/utils/createHandler';

import { assignGrooveTemplate } from '../../useCases/grooveTemplates/assignGrooveTemplate';
import { getGrooveAssignment } from '../../useCases/grooveTemplates/getGrooveAssignment';

export const handleAssignGrooveTemplate = createHandler<'assignGrooveTemplate'>({
    execute: (action) => {
        const result = assignGrooveTemplate(action.payload);
        if (!result.ok) {
            throw new Error(`Groove assignment rejected: ${result.error.code}`);
        }
    },
    describe: (action) => ({
        label: 'Assign groove template',
        inverseAction: {
            type: 'restoreGrooveAssignment',
            payload: {
                consumerType: action.payload.consumerType,
                consumerId: action.payload.consumerId,
                assignment: getGrooveAssignment(action.payload) ?? null,
            },
        },
    }),
    undoable: true,
});
