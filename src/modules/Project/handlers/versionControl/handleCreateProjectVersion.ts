import { createHandler } from '#/utils/createHandler';

import { createProjectVersion } from '../../useCases/versionControl/createProjectVersion';

export const handleCreateProjectVersion = createHandler<'createProjectVersion'>({
    // eslint-disable-next-line @typescript-eslint/require-await -- handler interface requires async execute; this handler has no asynchronous operations
    execute: async (alpha) => {
        createProjectVersion(alpha.payload.label, alpha.payload.description ?? '');
    },
    undoable: false,
    describe: () => ({ label: 'Create Project Version' }),
});
