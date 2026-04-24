import { createHandler } from '#/utils/createHandler';

import { assignToVca } from '../../useCases/vca/assignToVca';

export const handleAssignToVca = createHandler<'assignToVca'>({
    execute: (alpha) => {
        assignToVca(alpha.payload.trackId, alpha.payload.vcaGroupId);
    },
    describe: () => ({ label: 'Assign to VCA' }),
    undoable: true,
});
