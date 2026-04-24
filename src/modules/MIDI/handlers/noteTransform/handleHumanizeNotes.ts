import { createHandler } from '#/utils/createHandler';

import { humanizeNotes } from '../../useCases/midiNoteTransforms/humanizeNotes';

export const handleHumanizeNotes = createHandler<'humanizeNotes'>({
    execute: (action) => {
        humanizeNotes(action.payload.clipId, action.payload.amount);
    },
    describe: () => ({ label: 'Humanize notes' }),
    undoable: true,
});
