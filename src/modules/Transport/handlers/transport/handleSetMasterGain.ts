import { setMasterGain } from '#/modules/AudioEngine/useCases';
import { createHandler } from '#/utils/createHandler';

export const handleSetMasterGain = createHandler<'setMasterGain'>({
    execute: (alpha) => {
        setMasterGain(alpha.payload.gain);
    },
    describe: () => ({ label: 'Set master gain' }),
    undoable: true,
});
