import { quantizeNoteLengths } from '#/modules/MIDI/useCases';
import { createHandler } from '#/utils/createHandler';

export const handleQuantizeNoteLengths = createHandler<'quantizeNoteLengths'>({
    execute: (alpha) => {
        quantizeNoteLengths(alpha.payload.clipId, alpha.payload.gridSize);
    },
    describe: () => ({ label: 'Quantize note lengths' }),
    undoable: true,
});
