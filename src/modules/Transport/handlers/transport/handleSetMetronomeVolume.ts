import { createHandler } from '#/utils/createHandler';

import { setMetronomeVolume } from '../../useCases/transportControls/setMetronomeVolume';

export const handleSetMetronomeVolume = createHandler<'setMetronomeVolume'>({
    execute: (alpha) => {
        setMetronomeVolume(alpha.payload.volume);
    },
    describe: (alpha) => ({ label: `Set metronome volume to ${Math.round(alpha.payload.volume * 100)}%` }),
    undoable: true,
});
