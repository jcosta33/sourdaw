import { createHandler } from '#/utils/createHandler';

import { getGrooveTemplate } from '../../useCases/grooveTemplates/getGrooveTemplate';
import { renameGrooveTemplate } from '../../useCases/grooveTemplates/renameGrooveTemplate';

export const handleRenameGrooveTemplate = createHandler<'renameGrooveTemplate'>({
    execute: (action) => {
        renameGrooveTemplate(action.payload);
    },
    describe: (action) => {
        const current = getGrooveTemplate(action.payload.templateId);
        return {
            label: `Rename groove template to "${action.payload.name}"`,
            inverseAction: current
                ? { type: 'renameGrooveTemplate', payload: { templateId: current.id, name: current.name } }
                : null,
        };
    },
    undoable: true,
});
