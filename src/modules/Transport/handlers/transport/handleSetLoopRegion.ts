import { createHandler } from '#/utils/createHandler';

import { setLoopRegion } from '../../useCases/transportControls/setLoopRegion';

export const handleSetLoopRegion = createHandler<'setLoopRegion'>({
    execute: (alpha) => {
        setLoopRegion(alpha.payload.startBeat, alpha.payload.endBeat);
    },
    describe: () => ({ label: 'Set loop region' }),
    undoable: true,
});
