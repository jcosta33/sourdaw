import { createHandler } from '#/utils/createHandler';

import { deleteGrooveTemplate } from '../../useCases/grooveTemplates/deleteGrooveTemplate';
import { markGrooveTemplateProjectWrite } from '../../useCases/grooveTemplates/markGrooveTemplateProjectWrite';
import { snapshotGrooveTemplateDeletion } from '../../useCases/grooveTemplates/snapshotGrooveTemplateDeletion';

export const handleDeleteGrooveTemplate = createHandler<'deleteGrooveTemplate'>({
    isNoop: (action) => snapshotGrooveTemplateDeletion(action.payload.templateId) === null,
    execute: (action) => {
        const snapshot = deleteGrooveTemplate(action.payload.templateId);
        if (!snapshot) {
            return { status: 'no-write' };
        }
        return {
            status: 'written',
            afterCommit: markGrooveTemplateProjectWrite,
            afterAmbiguousCommit: markGrooveTemplateProjectWrite,
        };
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
