import { createHandler } from '#/utils/createHandler';

import { retrogradeNotes } from '../../useCases/midiNoteTransforms/retrogradeNotes';

export const handleRetrogradeNotes = createHandler<'retrogradeNotes'>({
    execute: (action) => {
        retrogradeNotes(action.payload.clipId);
    },
    describe: () => ({ label: 'Retrograde notes' }),
    undoable: true,
});
