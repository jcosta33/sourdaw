import { createHandler } from '#/utils/createHandler';

import { batchAddMidiNotes } from '../../useCases/midiNoteCrud/batchAddMidiNotes';

export const handleAddNotes = createHandler<'addNotes'>({
    execute: (action) => {
        batchAddMidiNotes(action.payload.clipId, action.payload.notes);
    },
    describe: (action) => ({
        label: `Add ${action.payload.notes.length} MIDI note${action.payload.notes.length === 1 ? '' : 's'}`,
    }),
    undoable: true,
});
