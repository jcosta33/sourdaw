import { createHandler } from '#/utils/createHandler';

import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { setTrackNotes } from '../../useCases/setTrackGainPan/setTrackNotes';

export const handleSetTrackNotes = createHandler<'setTrackNotes'>({
    execute: (action) => {
        setTrackNotes(action.payload.trackId, action.payload.notes);
    },
    describe: (alpha) => {
        const prev = getTrackStoreState()?.tracks.find((time) => time.id === alpha.payload.trackId);
        return {
            label: 'Set track notes',
            inverseAction: prev ? { type: 'setTrackNotes', payload: { trackId: prev.id, notes: prev.notes } } : null,
        };
    },
    undoable: true,
});
