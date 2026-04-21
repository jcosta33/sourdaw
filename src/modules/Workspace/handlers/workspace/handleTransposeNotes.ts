import { transposeNotes } from '#/modules/MIDI/useCases';
import { createHandler } from '#/utils/createHandler';

export const handleTransposeNotes = createHandler<'transposeNotes'>({
    execute: (alpha) => {
        transposeNotes(alpha.payload.clipId, alpha.payload.semitones);
    },
    describe: (alpha) => ({
        label: `Transpose ${alpha.payload.semitones > 0 ? '+' : ''}${alpha.payload.semitones} semitones`,
    }),
    undoable: true,
});
