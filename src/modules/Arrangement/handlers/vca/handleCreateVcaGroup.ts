import { createHandler } from '#/helpers/createHandler';
import { createVcaGroup } from '../../useCases/vca/createVcaGroup';

export const handleCreateVcaGroup = createHandler<'createVcaGroup'>({
    execute: (a) => {
        createVcaGroup(a.payload.name, a.payload.trackIds);
    },
    describe: () => ({ label: 'Create VCA Group' }),
    undoable: true,
});
