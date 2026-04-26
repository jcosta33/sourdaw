import { createHandler } from '#/utils/createHandler';

import { createVersionBranch } from '../../useCases/versionControl/branching/createVersionBranch';

export const handleCreateVersionBranch = createHandler<'createVersionBranch'>({
    // eslint-disable-next-line @typescript-eslint/require-await -- handler interface requires async execute; this handler has no asynchronous operations
    execute: async (alpha) => {
        createVersionBranch(alpha.payload.name);
    },
    undoable: false,
    describe: () => ({ label: 'Create Version Branch' }),
});
