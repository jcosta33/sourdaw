import { createHandler } from '#/utils/createHandler';
import { type AppAction } from '#/utils/handlerContract';

import { quantizeMidiNoteLengths } from '../../transformers/quantizeMidiNoteLengths';
import { quantizeNoteLengths } from '../../useCases/midiNoteTransforms/quantizeNoteLengths';

import { prepareMidiNoteTransformUndo } from './prepareMidiNoteTransformUndo';

function prepareQuantizeNoteLengths(action: Extract<AppAction, { type: 'quantizeNoteLengths' }>) {
    const label =
        action.payload.noteIds && action.payload.noteIds.length > 0
            ? 'Quantize selected note lengths'
            : 'Quantize note lengths';
    return prepareMidiNoteTransformUndo({
        clipId: action.payload.clipId,
        label,
        transform: (notes) =>
            quantizeMidiNoteLengths({
                notes,
                gridSize: action.payload.gridSize,
                noteIds: action.payload.noteIds,
            }),
    });
}

export const handleQuantizeNoteLengths = createHandler<'quantizeNoteLengths'>({
    execute: (action) => {
        const written = quantizeNoteLengths(action.payload.clipId, action.payload.gridSize, action.payload.noteIds);
        return { status: written ? 'written' : 'no-write' };
    },
    describe: (action) => prepareQuantizeNoteLengths(action).description,
    isNoop: (action) => prepareQuantizeNoteLengths(action).isNoop,
    undoable: true,
});
