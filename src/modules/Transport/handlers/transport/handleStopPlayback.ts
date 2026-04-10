import { createHandler } from '#/helpers/createHandler';
import { stopPlayback } from '../../useCases/transportControls/stopPlayback';

export const handleStopPlayback = createHandler<'stopPlayback'>({
    execute: () => {
        stopPlayback();
    },
    describe: () => ({ label: 'Stop playback' }),
    undoable: false,
});
