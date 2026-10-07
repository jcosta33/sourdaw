import { createHandler } from '#/utils/createHandler';
import { type AppAction } from '#/utils/handlerContract';

import { invertMidiNotes } from '../../transformers/invertMidiNotes';
import { invertNotes } from '../../useCases/midiNoteTransforms/invertNotes';
import { getWritableMidiClipReplayGuardForBatch } from '../getWritableMidiClipReplayGuard';

import { prepareMidiNoteTransformUndo } from './prepareMidiNoteTransformUndo';

function prepareInvertNotes(action: Extract<AppAction, { type: 'invertNotes' }>) {
    return prepareMidiNoteTransformUndo({
        clipId: action.payload.clipId,
        label: 'Invert notes',
        transform: invertMidiNotes,
    });
}

export const handleInvertNotes = createHandler<'invertNotes'>({
    execute: (action) => {
        if (!getWritableMidiClipReplayGuardForBatch(action.payload.clipId)) {
            return { status: 'conflict' };
        }
        const written = invertNotes(action.payload.clipId);
        return { status: written ? 'written' : 'no-write' };
    },
    describe: (action) => prepareInvertNotes(action).description,
    isNoop: (action) => prepareInvertNotes(action).isNoop,
    undoable: true,
});
