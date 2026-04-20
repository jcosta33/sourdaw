import { createHandler } from '#/utils/createHandler';

import { restoreVersion } from '../../useCases/versionControl/restoreVersion';

export const handleRestoreProjectVersion = createHandler<'restoreProjectVersion'>({
    execute: async (a) => {
        restoreVersion(a.payload.versionId);
    },
    undoable: true,
    describe: () => ({ label: 'Restore Project Version' }),
});
