import { createHandler } from '#/helpers/createHandler';
import { createProjectVersion } from '../../useCases/versionControl/createProjectVersion';

export const handleCreateProjectVersion = createHandler<'createProjectVersion'>({
    execute: async (a) => {
        createProjectVersion(a.payload.label, a.payload.description ?? '');
    },
    undoable: false,
    describe: () => ({ label: 'Create Project Version' }),
});
