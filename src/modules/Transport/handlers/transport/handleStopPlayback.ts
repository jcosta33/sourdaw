import { createHandler } from '#/utils/createHandler';

import { stopPlayback } from '../../useCases/transportControls/stopPlayback';

export const handleStopPlayback = createHandler<'stopPlayback'>({
    execute: () => {
        const teardown = stopPlayback();
        return {
            status: 'written',
            afterRuntimeExecution: () => teardown,
        };
    },
    describe: () => ({ label: 'Stop playback' }),
    executionKind: 'runtime',
    undoable: false,
});
