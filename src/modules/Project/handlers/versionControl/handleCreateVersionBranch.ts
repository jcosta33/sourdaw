import { createHandler } from '#/utils/createHandler';

import { createVersionBranch } from '../../useCases/versionControl/branching/createVersionBranch';

export const handleCreateVersionBranch = createHandler<'createVersionBranch'>({
    execute: async (alpha) => {
        createVersionBranch(alpha.payload.name);
    },
    undoable: false,
    describe: () => ({ label: 'Create Version Branch' }),
});
