import { createHandler } from '#/utils/createHandler';
import { stripSilence } from '../../useCases/stripSilence';

export const handleStripSilence = createHandler<'stripSilence'>({
    execute: (a) => {
        stripSilence(a.payload.clipId, a.payload.threshold, a.payload.minDuration);
    },
    describe: () => ({ label: 'Strip silence' }),
    undoable: true,
});
