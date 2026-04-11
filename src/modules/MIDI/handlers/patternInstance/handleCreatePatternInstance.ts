import { createHandler } from '#/helpers/createHandler';
import { createPatternInstance } from '../../useCases/patternInstance/createPatternInstance';

export const handleCreatePatternInstance = createHandler<'createPatternInstance'>({
    execute: async (a) => {
        createPatternInstance(a.payload.sourceClipId, a.payload.targetTrackId, a.payload.startBeat);
    },
    undoable: true,
    describe: () => ({ label: 'Create Pattern Instance' }),
});
