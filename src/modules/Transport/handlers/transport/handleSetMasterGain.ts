import { createHandler } from '#/helpers/createHandler';
import { setMasterGain } from '#/modules/AudioEngine';

export const handleSetMasterGain = createHandler<'setMasterGain'>({
    execute: (a) => {
        setMasterGain(a.payload.gain);
    },
    describe: () => ({ label: 'Set master gain' }),
    undoable: true,
});
