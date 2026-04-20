import { createHandler } from '#/utils/createHandler';

import { assignToVca } from '../../useCases/vca/assignToVca';

export const handleAssignToVca = createHandler<'assignToVca'>({
    execute: (a) => {
        assignToVca(a.payload.trackId, a.payload.vcaGroupId);
    },
    describe: () => ({ label: 'Assign to VCA' }),
    undoable: true,
});
