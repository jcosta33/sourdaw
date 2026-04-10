import { createHandler } from '#/helpers/createHandler';
import { transposeNotes } from '#/modules/MIDI';

export const handleTransposeNotes = createHandler<'transposeNotes'>({
    execute: (a) => {
        transposeNotes(a.payload.clipId, a.payload.semitones);
    },
    describe: (a) => ({
        label: `Transpose ${a.payload.semitones > 0 ? '+' : ''}${a.payload.semitones} semitones`,
    }),
    undoable: true,
});
