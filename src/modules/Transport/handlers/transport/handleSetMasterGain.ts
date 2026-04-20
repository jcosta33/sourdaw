import { setMasterGain } from '#/modules/AudioEngine/useCases';
import { createHandler } from '#/utils/createHandler';

export const handleSetMasterGain = createHandler<'setMasterGain'>({
    execute: (a) => {
        setMasterGain(a.payload.gain);
    },
    describe: () => ({ label: 'Set master gain' }),
    undoable: true,
});
