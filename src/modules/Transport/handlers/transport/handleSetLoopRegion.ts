import { createHandler } from '#/helpers/createHandler';
import { setLoopRegion } from '../../useCases/transportControls/setLoopRegion';

export const handleSetLoopRegion = createHandler<'setLoopRegion'>({
    execute: (a) => {
        setLoopRegion(a.payload.startBeat, a.payload.endBeat);
    },
    describe: () => ({ label: 'Set loop region' }),
    undoable: true,
});
