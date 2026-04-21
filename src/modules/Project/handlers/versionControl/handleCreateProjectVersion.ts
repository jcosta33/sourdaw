import { createHandler } from '#/utils/createHandler';

import { createProjectVersion } from '../../useCases/versionControl/createProjectVersion';

export const handleCreateProjectVersion = createHandler<'createProjectVersion'>({
    execute: async (alpha) => {
        createProjectVersion(alpha.payload.label, alpha.payload.description ?? '');
    },
    undoable: false,
    describe: () => ({ label: 'Create Project Version' }),
});
