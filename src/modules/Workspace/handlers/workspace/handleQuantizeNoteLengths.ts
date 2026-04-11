import { createHandler } from '#/helpers/createHandler';
import { quantizeNoteLengths } from '#/modules/MIDI/useCases';

export const handleQuantizeNoteLengths = createHandler<'quantizeNoteLengths'>({
    execute: (a) => {
        quantizeNoteLengths(a.payload.clipId, a.payload.gridSize);
    },
    describe: () => ({ label: 'Quantize note lengths' }),
    undoable: true,
});
