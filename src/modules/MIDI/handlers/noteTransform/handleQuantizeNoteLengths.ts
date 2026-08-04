import { createHandler } from '#/utils/createHandler';
import { type AppAction } from '#/utils/handlerContract';

import { quantizeMidiNoteLengths } from '../../transformers/quantizeMidiNoteLengths';
import { quantizeNoteLengths } from '../../useCases/midiNoteTransforms/quantizeNoteLengths';

import { prepareMidiNoteTransformUndo } from './prepareMidiNoteTransformUndo';

function prepareQuantizeNoteLengths(action: Extract<AppAction, { type: 'quantizeNoteLengths' }>) {
    return prepareMidiNoteTransformUndo({
        clipId: action.payload.clipId,
        label: 'Quantize note lengths',
        transform: (notes) => quantizeMidiNoteLengths({ notes, gridSize: action.payload.gridSize }),
    });
}

export const handleQuantizeNoteLengths = createHandler<'quantizeNoteLengths'>({
    execute: (action) => {
        const written = quantizeNoteLengths(action.payload.clipId, action.payload.gridSize);
        return { status: written ? 'written' : 'no-write' };
    },
    describe: (action) => prepareQuantizeNoteLengths(action).description,
    isNoop: (action) => prepareQuantizeNoteLengths(action).isNoop,
    undoable: true,
});
