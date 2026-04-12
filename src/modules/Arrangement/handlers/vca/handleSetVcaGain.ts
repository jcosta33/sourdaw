import { createHandler } from '#/utils/createHandler';
import { setVcaGain } from '../../useCases/vca/setVcaGain';

export const handleSetVcaGain = createHandler<'setVcaGain'>({
    execute: (a) => {
        setVcaGain(a.payload.vcaGroupId, a.payload.gain);
    },
    describe: () => ({ label: 'Set VCA Gain' }),
    undoable: true,
});
