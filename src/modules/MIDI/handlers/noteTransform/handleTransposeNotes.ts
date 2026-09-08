import { createHandler } from '#/utils/createHandler';
import { type AppAction } from '#/utils/handlerContract';

import { transposeMidiNotes } from '../../transformers/transposeMidiNotes';
import { transposeNotes } from '../../useCases/midiNoteTransforms/transposeNotes';

import { prepareMidiNoteTransformUndo } from './prepareMidiNoteTransformUndo';

function prepareTransposeNotes(action: Extract<AppAction, { type: 'transposeNotes' }>) {
    const semitoneLabel = `${action.payload.semitones > 0 ? '+' : ''}${action.payload.semitones}`;
    const isSelected = action.payload.noteIds && action.payload.noteIds.length > 0;
    const label = isSelected
        ? `Transpose selected notes ${semitoneLabel} semitones`
        : `Transpose ${semitoneLabel} semitones`;
    return prepareMidiNoteTransformUndo({
        clipId: action.payload.clipId,
        label,
        transform: (notes) =>
            transposeMidiNotes({
                notes,
                semitones: action.payload.semitones,
                noteIds: action.payload.noteIds,
            }),
    });
}

export const handleTransposeNotes = createHandler<'transposeNotes'>({
    execute: (action) => {
        const written = transposeNotes(action.payload.clipId, action.payload.semitones, action.payload.noteIds);
        return { status: written ? 'written' : 'no-write' };
    },
    describe: (action) => prepareTransposeNotes(action).description,
    isNoop: (action) => prepareTransposeNotes(action).isNoop,
    undoable: true,
});
