import { createHandler } from '#/utils/createHandler';

import { setMetronomeVolume } from '../../useCases/transportControls/setMetronomeVolume';

export const handleSetMetronomeVolume = createHandler<'setMetronomeVolume'>({
    execute: (a) => {
        setMetronomeVolume(a.payload.volume);
    },
    describe: (a) => ({ label: `Set metronome volume to ${Math.round(a.payload.volume * 100)}%` }),
    undoable: true,
});
