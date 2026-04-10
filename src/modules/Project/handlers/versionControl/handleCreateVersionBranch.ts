import { createHandler } from '#/helpers/createHandler';
import { createVersionBranch } from '../../useCases/versionControl/branching';

export const handleCreateVersionBranch = createHandler<'createVersionBranch'>({
    execute: async (a) => {
        createVersionBranch(a.payload.name);
    },
    undoable: false,
    describe: () => ({ label: 'Create Version Branch' }),
});
