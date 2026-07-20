import { createHandler } from '#/utils/createHandler';

import { assignToVca } from '../../useCases/vca/assignToVca';
import { captureLegacyVcaState } from '../../useCases/vca/captureLegacyVcaState';

export const handleAssignToVca = createHandler<'assignToVca'>({
    execute: (alpha) => {
        const written = assignToVca(alpha.payload.trackId, alpha.payload.vcaGroupId);
        if (!written) {
            return { status: 'no-write' };
        }
        return { status: 'written' };
    },
    describe: (alpha) => ({
        label: 'Assign to VCA',
        inverseAction: { type: 'restoreLegacyVcaState', payload: captureLegacyVcaState(alpha) },
    }),
    undoable: true,
});
