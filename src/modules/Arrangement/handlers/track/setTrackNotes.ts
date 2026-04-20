import { createHandler } from '#/utils/createHandler';

import { setTrackNotes } from '../../useCases/setTrackGainPan/setTrackNotes';

export const handleSetTrackNotes = createHandler<'setTrackNotes'>({
    execute: (action) => {
        setTrackNotes(action.payload.trackId, action.payload.notes);
    },
    describe: () => ({ label: 'Set track notes' }),
    undoable: true,
});
