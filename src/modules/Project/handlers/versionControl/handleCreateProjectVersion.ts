import { createHandler } from '#/utils/createHandler';

import { createProjectVersion } from '../../useCases/versionControl/createProjectVersion';

export const handleCreateProjectVersion = createHandler<'createProjectVersion'>({
    execute: async (a) => {
        createProjectVersion(a.payload.label, a.payload.description ?? '');
    },
    undoable: false,
    describe: () => ({ label: 'Create Project Version' }),
});
