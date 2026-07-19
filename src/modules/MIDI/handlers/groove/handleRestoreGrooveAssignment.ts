import { createHandler } from '#/utils/createHandler';

import { restoreGrooveAssignment } from '../../useCases/grooveTemplates/restoreGrooveAssignment';

export const handleRestoreGrooveAssignment = createHandler<'restoreGrooveAssignment'>({
    execute: (action) => {
        restoreGrooveAssignment(action.payload);
    },
    describe: () => ({ label: 'Restore groove assignment' }),
    undoable: false,
});
