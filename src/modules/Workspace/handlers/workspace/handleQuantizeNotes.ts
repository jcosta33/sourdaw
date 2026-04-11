import { createHandler } from '#/helpers/createHandler';
import { quantizeNotes } from '#/modules/MIDI/useCases';

export const handleQuantizeNotes = createHandler<'quantizeNotes'>({
    execute: (a) => {
        quantizeNotes(a.payload.clipId, a.payload.gridSize);
    },
    describe: () => ({ label: 'Quantize notes' }),
    undoable: true,
});
