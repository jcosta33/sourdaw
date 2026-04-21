import { createHandler } from '#/utils/createHandler';

import { createVcaGroup } from '../../useCases/vca/createVcaGroup';

export const handleCreateVcaGroup = createHandler<'createVcaGroup'>({
    execute: (alpha) => {
        createVcaGroup(alpha.payload.name, alpha.payload.trackIds);
    },
    describe: () => ({ label: 'Create VCA Group' }),
    undoable: true,
});
