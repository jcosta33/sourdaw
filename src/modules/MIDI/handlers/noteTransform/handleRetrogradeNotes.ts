import { createHandler } from '#/utils/createHandler';
import { type AppAction } from '#/utils/handlerContract';

import { retrogradeMidiNotes } from '../../transformers/retrogradeMidiNotes';
import { retrogradeNotes } from '../../useCases/midiNoteTransforms/retrogradeNotes';

import { prepareMidiNoteTransformUndo } from './prepareMidiNoteTransformUndo';

function prepareRetrogradeNotes(action: Extract<AppAction, { type: 'retrogradeNotes' }>) {
    return prepareMidiNoteTransformUndo({
        clipId: action.payload.clipId,
        label: 'Retrograde notes',
        transform: retrogradeMidiNotes,
    });
}

export const handleRetrogradeNotes = createHandler<'retrogradeNotes'>({
    execute: (action) => {
        const written = retrogradeNotes(action.payload.clipId);
        return { status: written ? 'written' : 'no-write' };
    },
    describe: (action) => prepareRetrogradeNotes(action).description,
    isNoop: (action) => prepareRetrogradeNotes(action).isNoop,
    undoable: true,
});
