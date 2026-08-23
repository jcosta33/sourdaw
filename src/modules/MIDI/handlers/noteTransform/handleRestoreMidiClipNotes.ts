import { createHandler } from '#/utils/createHandler';

import { getRestoreMidiClipNotesStatus } from '../../useCases/midiNoteTransforms/getRestoreMidiClipNotesStatus';
import { restoreMidiClipNotes } from '../../useCases/midiNoteTransforms/restoreMidiClipNotes';

export const handleRestoreMidiClipNotes = createHandler<'restoreMidiClipNotes'>({
    execute: (action) => ({ status: restoreMidiClipNotes(action.payload) }),
    validate: (action) => getRestoreMidiClipNotesStatus(action.payload) !== 'conflict',
    canReapplyAfterDivergence: (action) =>
        action.payload.clipId.length > 0 &&
        Array.isArray(action.payload.notes) &&
        Array.isArray(action.payload.expectedNotes),
    describe: () => ({ label: 'Restore MIDI clip notes' }),
    previewExecution: 'isolated-project',
    requiresAbortCompensation: false,
    undoable: false,
});
