import { createHandler } from '#/utils/createHandler';

import { restoreGrooveTemplateName } from '../../useCases/grooveTemplates/restoreGrooveTemplateName';

export const handleRestoreGrooveTemplateName = createHandler<'restoreGrooveTemplateName'>({
    execute: (action) => restoreGrooveTemplateName(action.payload),
    describe: () => ({ label: 'Restore groove template name' }),
    undoable: false,
});
