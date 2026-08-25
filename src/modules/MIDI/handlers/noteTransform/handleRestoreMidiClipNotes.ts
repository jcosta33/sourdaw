import { createHandler } from '#/utils/createHandler';
import { type AppAction } from '#/utils/handlerContract';

import { getRestoreMidiClipNotesStatus } from '../../useCases/midiNoteTransforms/getRestoreMidiClipNotesStatus';
import { restoreMidiClipNotes } from '../../useCases/midiNoteTransforms/restoreMidiClipNotes';

type RestoreMidiClipNotesAction = Extract<AppAction, { type: 'restoreMidiClipNotes' }>;

function canReapplyRestoreMidiClipNotesAfterDivergence(action: RestoreMidiClipNotesAction): boolean {
    const hasReplayGuard =
        action.payload.articulationReplayGuard !== undefined || action.payload.noteTransformReplayGuard !== undefined;

    return hasReplayGuard && getRestoreMidiClipNotesStatus(action.payload) !== 'conflict';
}

export const handleRestoreMidiClipNotes = createHandler<'restoreMidiClipNotes'>({
    execute: (action) => ({ status: restoreMidiClipNotes(action.payload) }),
    validate: (action) => getRestoreMidiClipNotesStatus(action.payload) !== 'conflict',
    canReapplyAfterDivergence: canReapplyRestoreMidiClipNotesAfterDivergence,
    describe: () => ({ label: 'Restore MIDI clip notes' }),
    previewExecution: 'isolated-project',
    requiresAbortCompensation: false,
    undoable: false,
});
