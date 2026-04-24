import { createHandler } from '#/utils/createHandler';

import { createPatternInstance } from '../../useCases/patternInstance/createPatternInstance';

export const handleCreatePatternInstance = createHandler<'createPatternInstance'>({
    // eslint-disable-next-line @typescript-eslint/require-await -- handler interface requires async execute; this handler has no asynchronous operations
    execute: async (alpha) => {
        createPatternInstance(alpha.payload.sourceClipId, alpha.payload.targetTrackId, alpha.payload.startBeat);
    },
    undoable: true,
    describe: () => ({ label: 'Create Pattern Instance' }),
});
