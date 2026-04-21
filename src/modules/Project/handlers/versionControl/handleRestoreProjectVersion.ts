import { createHandler } from '#/utils/createHandler';

import { restoreVersion } from '../../useCases/versionControl/restoreVersion';

export const handleRestoreProjectVersion = createHandler<'restoreProjectVersion'>({
    execute: async (alpha) => {
        restoreVersion(alpha.payload.versionId);
    },
    undoable: true,
    describe: () => ({ label: 'Restore Project Version' }),
});
