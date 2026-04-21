import { createHandler } from '#/utils/createHandler';

import { detachPatternInstance } from '../../useCases/patternInstance/detachPatternInstance';

export const handleDetachPatternInstance = createHandler<'detachPatternInstance'>({
    execute: async (alpha) => {
        detachPatternInstance(alpha.payload.clipId);
    },
    undoable: true,
    describe: () => ({ label: 'Detach Pattern Instance' }),
});
