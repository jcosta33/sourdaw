import { createHandler } from '#/helpers/createHandler';
import { setTempo } from '../../useCases/setTempo';

export const handleSetTempo = createHandler<'setTempo'>({
    execute: (a) => {
        setTempo(a.payload.bpm);
    },
    describe: (a) => ({ label: `Set tempo to ${a.payload.bpm} BPM` }),
    undoable: true,
});
