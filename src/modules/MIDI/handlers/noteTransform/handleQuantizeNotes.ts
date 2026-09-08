import { createHandler } from '#/utils/createHandler';
import { type AppAction } from '#/utils/handlerContract';

import { quantizeMidiNotes } from '../../transformers/quantizeMidiNotes';
import { quantizeNotes } from '../../useCases/midiNoteTransforms/quantizeNotes';

import { prepareMidiNoteTransformUndo } from './prepareMidiNoteTransformUndo';

function prepareQuantizeNotes(action: Extract<AppAction, { type: 'quantizeNotes' }>) {
    const label =
        action.payload.noteIds && action.payload.noteIds.length > 0 ? 'Quantize selected notes' : 'Quantize notes';
    return prepareMidiNoteTransformUndo({
        clipId: action.payload.clipId,
        label,
        transform: (notes) =>
            quantizeMidiNotes({
                notes,
                gridSize: action.payload.gridSize,
                strength: action.payload.strength,
                swing: action.payload.swing,
                noteIds: action.payload.noteIds,
            }),
    });
}

export const handleQuantizeNotes = createHandler<'quantizeNotes'>({
    execute: (action) => {
        const written = quantizeNotes(
            action.payload.clipId,
            action.payload.gridSize,
            action.payload.strength,
            action.payload.swing,
            action.payload.noteIds
        );
        return { status: written ? 'written' : 'no-write' };
    },
    describe: (action) => prepareQuantizeNotes(action).description,
    isNoop: (action) => prepareQuantizeNotes(action).isNoop,
    undoable: true,
});
