import { createHandler } from '#/utils/createHandler';

import { detachPatternInstance } from '../../useCases/patternInstance/detachPatternInstance';

export const handleDetachPatternInstance = createHandler<'detachPatternInstance'>({
    // eslint-disable-next-line @typescript-eslint/require-await -- handler interface requires async execute; this handler has no asynchronous operations
    execute: async (alpha) => {
        detachPatternInstance(alpha.payload.clipId);
    },
    undoable: true,
    describe: () => ({ label: 'Detach Pattern Instance' }),
});
