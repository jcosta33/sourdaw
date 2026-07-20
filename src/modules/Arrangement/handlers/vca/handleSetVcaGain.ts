import { createHandler } from '#/utils/createHandler';

import { captureLegacyVcaState } from '../../useCases/vca/captureLegacyVcaState';
import { setVcaGain } from '../../useCases/vca/setVcaGain';

export const handleSetVcaGain = createHandler<'setVcaGain'>({
    execute: (alpha) => {
        const written = setVcaGain(alpha.payload.vcaGroupId, alpha.payload.gain);
        if (!written) {
            return { status: 'no-write' };
        }
        return { status: 'written' };
    },
    describe: () => ({
        label: 'Set VCA Gain',
        inverseAction: { type: 'restoreLegacyVcaState', payload: captureLegacyVcaState() },
    }),
    undoable: true,
});
