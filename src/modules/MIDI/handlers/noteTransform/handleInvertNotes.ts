import { createHandler } from '#/utils/createHandler';

import { invertNotes } from '../../useCases/midiNoteTransforms/invertNotes';

export const handleInvertNotes = createHandler<'invertNotes'>({
    execute: (action) => {
        invertNotes(action.payload.clipId);
    },
    describe: () => ({ label: 'Invert notes' }),
    undoable: true,
});
