import { createHandler } from '#/utils/createHandler';

import { createPatternInstance } from '../../useCases/patternInstance/createPatternInstance';

export const handleCreatePatternInstance = createHandler<'createPatternInstance'>({
    execute: (alpha) => {
        const instanceId = createPatternInstance(
            alpha.payload.sourceClipId,
            alpha.payload.targetTrackId,
            alpha.payload.startBeat
        );
        if (instanceId === null) {
            return { status: 'no-write' };
        }

        return { status: 'written' };
    },
    undoable: true,
    describe: () => ({ label: 'Create Pattern Instance' }),
});
