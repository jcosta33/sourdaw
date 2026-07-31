import { createHandler } from '#/utils/createHandler';
import { type AppAction } from '#/utils/handlerContract';

import { transposeMidiNotes } from '../../transformers/transposeMidiNotes';
import { transposeNotes } from '../../useCases/midiNoteTransforms/transposeNotes';

import { prepareMidiNoteTransformUndo } from './prepareMidiNoteTransformUndo';

function prepareTransposeNotes(action: Extract<AppAction, { type: 'transposeNotes' }>) {
    const semitoneLabel = `${action.payload.semitones > 0 ? '+' : ''}${action.payload.semitones}`;
    return prepareMidiNoteTransformUndo({
        clipId: action.payload.clipId,
        label: `Transpose ${semitoneLabel} semitones`,
        transform: (notes) => transposeMidiNotes({ notes, semitones: action.payload.semitones }),
    });
}

export const handleTransposeNotes = createHandler<'transposeNotes'>({
    execute: (action) => {
        const written = transposeNotes(action.payload.clipId, action.payload.semitones);
        return { status: written ? 'written' : 'no-write' };
    },
    describe: (action) => prepareTransposeNotes(action).description,
    isNoop: (action) => prepareTransposeNotes(action).isNoop,
    undoable: true,
});
