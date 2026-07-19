import { createHandler } from '#/utils/createHandler';

import { deleteGrooveTemplate } from '../../useCases/grooveTemplates/deleteGrooveTemplate';
import { snapshotGrooveTemplateDeletion } from '../../useCases/grooveTemplates/snapshotGrooveTemplateDeletion';

export const handleDeleteGrooveTemplate = createHandler<'deleteGrooveTemplate'>({
    isNoop: (action) => snapshotGrooveTemplateDeletion(action.payload.templateId) === null,
    execute: (action) => {
        const snapshot = deleteGrooveTemplate(action.payload.templateId);
        return { status: snapshot ? 'written' : 'no-write' };
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
