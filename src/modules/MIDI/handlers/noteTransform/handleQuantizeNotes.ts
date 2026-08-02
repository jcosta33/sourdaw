import { createHandler } from '#/utils/createHandler';
import { type AppAction } from '#/utils/handlerContract';

import { quantizeMidiNotes } from '../../transformers/quantizeMidiNotes';
import { quantizeNotes } from '../../useCases/midiNoteTransforms/quantizeNotes';

import { prepareMidiNoteTransformUndo } from './prepareMidiNoteTransformUndo';

function prepareQuantizeNotes(action: Extract<AppAction, { type: 'quantizeNotes' }>) {
    return prepareMidiNoteTransformUndo({
        clipId: action.payload.clipId,
        label: 'Quantize notes',
        transform: (notes) =>
            quantizeMidiNotes({
                notes,
                gridSize: action.payload.gridSize,
                strength: action.payload.strength,
                swing: action.payload.swing,
            }),
    });
}

export const handleQuantizeNotes = createHandler<'quantizeNotes'>({
    execute: (action) => {
        const written = quantizeNotes(
            action.payload.clipId,
            action.payload.gridSize,
            action.payload.strength,
            action.payload.swing
        );
        return { status: written ? 'written' : 'no-write' };
    },
    describe: (action) => prepareQuantizeNotes(action).description,
    isNoop: (action) => prepareQuantizeNotes(action).isNoop,
    undoable: true,
});
