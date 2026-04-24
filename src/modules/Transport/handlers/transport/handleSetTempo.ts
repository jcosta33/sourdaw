import { createHandler } from '#/utils/createHandler';

import { setTempo } from '../../useCases/setTempo';

export const handleSetTempo = createHandler<'setTempo'>({
    execute: (alpha) => {
        setTempo(alpha.payload.bpm);
    },
    describe: (alpha) => ({ label: `Set tempo to ${alpha.payload.bpm} BPM` }),
    undoable: true,
});
