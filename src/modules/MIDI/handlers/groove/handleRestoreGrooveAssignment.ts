import { createHandler } from '#/utils/createHandler';

import { markGrooveTemplateProjectWrite } from '../../useCases/grooveTemplates/markGrooveTemplateProjectWrite';
import { restoreGrooveAssignment } from '../../useCases/grooveTemplates/restoreGrooveAssignment';

export const handleRestoreGrooveAssignment = createHandler<'restoreGrooveAssignment'>({
    execute: (action) => {
        const result = restoreGrooveAssignment(action.payload);
        if (result.status === 'no-write') {
            return { status: 'no-write' };
        }
        return {
            status: 'written',
            afterCommit: markGrooveTemplateProjectWrite,
            afterAmbiguousCommit: markGrooveTemplateProjectWrite,
        };
    },
    describe: () => ({ label: 'Restore groove assignment' }),
    undoable: false,
});
