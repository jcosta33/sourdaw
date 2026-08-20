import { createHandler } from '#/utils/createHandler';

import { createCompGroup } from '../../useCases/groupComping/compGroupOperations/createCompGroup';

export const handleCreateCompGroup = createHandler<'createCompGroup'>({
    execute: (alpha) => {
        createCompGroup(alpha.payload.name, alpha.payload.trackIds);
    },
    describe: () => ({ label: 'Create Comp Group' }),
    undoable: false,
});
