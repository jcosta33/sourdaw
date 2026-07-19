import { createHandler } from '#/utils/createHandler';

import { assignGrooveTemplate } from '../../useCases/grooveTemplates/assignGrooveTemplate';
import { canonicalizeGrooveTemplateAssignment } from '../../useCases/grooveTemplates/canonicalizeGrooveTemplateAssignment';
import { getGrooveAssignment } from '../../useCases/grooveTemplates/getGrooveAssignment';

export const handleAssignGrooveTemplate = createHandler<'assignGrooveTemplate'>({
    execute: (action) => {
        const result = assignGrooveTemplate(action.payload);
        if (!result.ok) {
            throw new Error(`Groove assignment rejected: ${result.error.code}`);
        }
    },
    describe: (action) => {
        const expectedAssignment = canonicalizeGrooveTemplateAssignment(action.payload);
        return {
            label: 'Assign groove template',
            inverseAction: expectedAssignment
                ? {
                      type: 'restoreGrooveAssignment',
                      payload: {
                          consumerType: action.payload.consumerType,
                          consumerId: action.payload.consumerId,
                          assignment: getGrooveAssignment(action.payload) ?? null,
                          expectedAssignment,
                      },
                  }
                : null,
        };
    },
    undoable: true,
});
