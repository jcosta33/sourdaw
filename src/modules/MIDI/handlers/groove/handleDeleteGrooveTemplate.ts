import { createHandler } from '#/utils/createHandler';

import { deleteGrooveTemplate } from '../../useCases/grooveTemplates/deleteGrooveTemplate';
import { snapshotGrooveTemplateDeletion } from '../../useCases/grooveTemplates/snapshotGrooveTemplateDeletion';

export const handleDeleteGrooveTemplate = createHandler<'deleteGrooveTemplate'>({
    execute: (action) => {
        deleteGrooveTemplate(action.payload.templateId);
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
