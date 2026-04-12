import { createHandler } from '#/utils/createHandler';
import { setMasterGain } from '#/modules/AudioEngine/useCases';

export const handleSetMasterGain = createHandler<'setMasterGain'>({
    execute: (a) => {
        setMasterGain(a.payload.gain);
    },
    describe: () => ({ label: 'Set master gain' }),
    undoable: true,
});
