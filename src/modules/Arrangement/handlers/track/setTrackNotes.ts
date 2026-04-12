import { setTrackNotes } from '../../useCases/setTrackGainPan/setTrackNotes';
import { createHandler } from '#/utils/createHandler';

export const handleSetTrackNotes = createHandler<'setTrackNotes'>({
    execute: (action) => {
        setTrackNotes(action.payload.trackId, action.payload.notes);
    },
    describe: () => ({ label: 'Set track notes' }),
    undoable: true,
});
