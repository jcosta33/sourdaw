import { createHandler } from '#/utils/createHandler';

import { createPatternInstance } from '../../useCases/patternInstance/createPatternInstance';

export const handleCreatePatternInstance = createHandler<'createPatternInstance'>({
    execute: async (alpha) => {
        createPatternInstance(alpha.payload.sourceClipId, alpha.payload.targetTrackId, alpha.payload.startBeat);
    },
    undoable: true,
    describe: () => ({ label: 'Create Pattern Instance' }),
});
