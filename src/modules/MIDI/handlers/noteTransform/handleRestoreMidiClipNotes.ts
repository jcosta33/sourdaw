import { createHandler } from '#/utils/createHandler';

import { restoreMidiClipNotes } from '../../useCases/midiNoteTransforms/restoreMidiClipNotes';

export const handleRestoreMidiClipNotes = createHandler<'restoreMidiClipNotes'>({
    execute: (action) => ({ status: restoreMidiClipNotes(action.payload) }),
    describe: () => ({ label: 'Restore MIDI clip notes' }),
    undoable: false,
});
