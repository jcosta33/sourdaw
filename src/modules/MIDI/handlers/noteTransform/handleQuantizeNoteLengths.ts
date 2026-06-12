import { createHandler } from '#/utils/createHandler';

import { quantizeNoteLengths } from '../../useCases/midiNoteTransforms/quantizeNoteLengths';

export const handleQuantizeNoteLengths = createHandler<'quantizeNoteLengths'>({
    execute: (action) => {
        quantizeNoteLengths(action.payload.clipId, action.payload.gridSize);
    },
    describe: () => ({ label: 'Quantize note lengths' }),
    undoable: true,
});
