import { createHandler } from '#/utils/createHandler';

import { markGrooveTemplateProjectWrite } from '../../useCases/grooveTemplates/markGrooveTemplateProjectWrite';
import { restoreDeletedGrooveTemplate } from '../../useCases/grooveTemplates/restoreDeletedGrooveTemplate';

export const handleRestoreDeletedGrooveTemplate = createHandler<'restoreDeletedGrooveTemplate'>({
    execute: (action) => {
        const result = restoreDeletedGrooveTemplate(action.payload);
        if (result.status === 'no-write') {
            return { status: 'no-write' };
        }
        return {
            status: 'written',
            afterCommit: markGrooveTemplateProjectWrite,
            afterAmbiguousCommit: markGrooveTemplateProjectWrite,
        };
    },
    describe: () => ({ label: 'Restore groove template' }),
    undoable: false,
});
