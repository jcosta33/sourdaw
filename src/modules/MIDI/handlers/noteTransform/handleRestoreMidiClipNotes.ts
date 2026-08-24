import { createHandler } from '#/utils/createHandler';

import { getRestoreMidiClipNotesStatus } from '../../useCases/midiNoteTransforms/getRestoreMidiClipNotesStatus';
import { restoreMidiClipNotes } from '../../useCases/midiNoteTransforms/restoreMidiClipNotes';

export const handleRestoreMidiClipNotes = createHandler<'restoreMidiClipNotes'>({
    canReapplyAfterDivergence: (action) =>
        action.payload.articulationReplayGuard !== undefined || action.payload.noteTransformReplayGuard !== undefined,
    execute: (action) => ({ status: restoreMidiClipNotes(action.payload) }),
    validate: (action) => getRestoreMidiClipNotesStatus(action.payload) !== 'conflict',
    describe: () => ({ label: 'Restore MIDI clip notes' }),
    previewExecution: 'isolated-project',
    requiresAbortCompensation: false,
    undoable: false,
});
