import { quantizeNotes } from '#/modules/MIDI/useCases';
import { createHandler } from '#/utils/createHandler';

export const handleQuantizeNotes = createHandler<'quantizeNotes'>({
    execute: (a) => {
        quantizeNotes(a.payload.clipId, a.payload.gridSize, a.payload.strength, a.payload.swing);
    },
    describe: () => ({ label: 'Quantize notes' }),
    undoable: true,
});
