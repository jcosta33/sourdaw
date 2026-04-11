import { createHandler } from '#/helpers/createHandler';
import { createCompGroup } from '../../useCases/groupComping/compGroupOperations/createCompGroup';

export const handleCreateCompGroup = createHandler<'createCompGroup'>({
    execute: (a) => {
        createCompGroup(a.payload.name, a.payload.trackIds);
    },
    describe: () => ({ label: 'Create Comp Group' }),
    undoable: true,
});
