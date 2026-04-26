import { createHandler } from '#/utils/createHandler';

import { setVcaGain } from '../../useCases/vca/setVcaGain';

export const handleSetVcaGain = createHandler<'setVcaGain'>({
    execute: (alpha) => {
        setVcaGain(alpha.payload.vcaGroupId, alpha.payload.gain);
    },
    describe: () => ({ label: 'Set VCA Gain' }),
    undoable: true,
});
