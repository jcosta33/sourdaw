import { quantizeNotes } from '#/modules/MIDI/useCases';
import { createHandler } from '#/utils/createHandler';

export const handleQuantizeNotes = createHandler<'quantizeNotes'>({
    execute: (alpha) => {
        quantizeNotes(alpha.payload.clipId, alpha.payload.gridSize, alpha.payload.strength, alpha.payload.swing);
    },
    describe: () => ({ label: 'Quantize notes' }),
    undoable: true,
});
