import { createHandler } from '#/utils/createHandler';

import { markGrooveTemplateProjectWrite } from '../../useCases/grooveTemplates/markGrooveTemplateProjectWrite';
import { restoreGrooveTemplateName } from '../../useCases/grooveTemplates/restoreGrooveTemplateName';

export const handleRestoreGrooveTemplateName = createHandler<'restoreGrooveTemplateName'>({
    execute: (action) => {
        const result = restoreGrooveTemplateName(action.payload);
        if (result.status === 'no-write') {
            return { status: 'no-write' };
        }
        return {
            status: 'written',
            afterCommit: markGrooveTemplateProjectWrite,
            afterAmbiguousCommit: markGrooveTemplateProjectWrite,
        };
    },
    describe: () => ({ label: 'Restore groove template name' }),
    undoable: false,
});
