import { createHandler } from '#/utils/createHandler';

import { detachPatternInstance } from '../../useCases/patternInstance/detachPatternInstance';

export const handleDetachPatternInstance = createHandler<'detachPatternInstance'>({
    execute: (alpha) => {
        const didDetach = detachPatternInstance(alpha.payload.clipId);
        if (!didDetach) {
            return { status: 'no-write' };
        }

        return { status: 'written' };
    },
    undoable: true,
    describe: () => ({ label: 'Detach Pattern Instance' }),
});
