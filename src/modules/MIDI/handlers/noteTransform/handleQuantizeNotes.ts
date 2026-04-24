import { createHandler } from '#/utils/createHandler';

import { quantizeNotes } from '../../useCases/midiNoteTransforms/quantizeNotes';

export const handleQuantizeNotes = createHandler<'quantizeNotes'>({
    execute: (action) => {
        quantizeNotes(action.payload.clipId, action.payload.gridSize, action.payload.strength, action.payload.swing);
    },
    describe: () => ({ label: 'Quantize notes' }),
    undoable: true,
});
