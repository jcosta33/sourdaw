import { createHandler } from '#/utils/createHandler';
import { detachPatternInstance } from '../../useCases/patternInstance/detachPatternInstance';

export const handleDetachPatternInstance = createHandler<'detachPatternInstance'>({
    execute: async (a) => {
        detachPatternInstance(a.payload.clipId);
    },
    undoable: true,
    describe: () => ({ label: 'Detach Pattern Instance' }),
});
