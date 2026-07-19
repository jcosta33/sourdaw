import { createHandler } from '#/utils/createHandler';

import { createGrooveTemplate } from '../../useCases/grooveTemplates/createGrooveTemplate';
import { getGrooveTemplate } from '../../useCases/grooveTemplates/getGrooveTemplate';

export const handleCreateGrooveTemplate = createHandler<'createGrooveTemplate'>({
    execute: (action) => {
        createGrooveTemplate(action.payload);
    },
    describe: (action) => ({
        label: `Create groove template "${action.payload.name}"`,
        inverseAction: getGrooveTemplate(action.payload.id)
            ? null
            : { type: 'deleteGrooveTemplate', payload: { templateId: action.payload.id } },
    }),
    undoable: true,
});
