import { createHandler } from '#/utils/createHandler';

import { transposeNotes } from '../../useCases/midiNoteTransforms/transposeNotes';

export const handleTransposeNotes = createHandler<'transposeNotes'>({
    execute: (action) => {
        transposeNotes(action.payload.clipId, action.payload.semitones);
    },
    describe: (action) => ({
        label: `Transpose ${action.payload.semitones > 0 ? '+' : ''}${action.payload.semitones} semitones`,
    }),
    undoable: true,
});
