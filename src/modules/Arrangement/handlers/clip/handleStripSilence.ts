import { createHandler } from '#/utils/createHandler';

import { stripSilence } from '../../useCases/stripSilence';

export const handleStripSilence = createHandler<'stripSilence'>({
    execute: (alpha) => {
        stripSilence(alpha.payload.clipId, alpha.payload.threshold, alpha.payload.minDuration);
    },
    describe: () => ({ label: 'Strip silence' }),
    undoable: true,
});
