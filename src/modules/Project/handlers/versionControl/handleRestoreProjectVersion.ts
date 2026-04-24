import { createHandler } from '#/utils/createHandler';

import { restoreVersion } from '../../useCases/versionControl/restoreVersion';

export const handleRestoreProjectVersion = createHandler<'restoreProjectVersion'>({
    // eslint-disable-next-line @typescript-eslint/require-await -- handler interface requires async execute; this handler has no asynchronous operations
    execute: async (alpha) => {
        restoreVersion(alpha.payload.versionId);
    },
    undoable: true,
    describe: () => ({ label: 'Restore Project Version' }),
});
