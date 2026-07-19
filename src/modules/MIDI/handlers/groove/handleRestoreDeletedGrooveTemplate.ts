import { createHandler } from '#/utils/createHandler';

import { restoreDeletedGrooveTemplate } from '../../useCases/grooveTemplates/restoreDeletedGrooveTemplate';

export const handleRestoreDeletedGrooveTemplate = createHandler<'restoreDeletedGrooveTemplate'>({
    execute: (action) => {
        restoreDeletedGrooveTemplate(action.payload);
    },
    describe: () => ({ label: 'Restore groove template' }),
    undoable: false,
});
