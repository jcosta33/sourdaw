import { createHandler } from '#/utils/createHandler';

import { chordTrackStore } from '../../stores/chordTrackStore';
import { updateChordEvent } from '../../useCases/chordTrack/updateChordEvent';

export const handleUpdateChordEvent = createHandler<'updateChordEvent'>({
    execute: (action) => {
        const { eventId, ...partial } = action.payload;
        updateChordEvent(eventId, partial);
    },
    describe: () => {
        const state = chordTrackStore.value;
        return {
            label: 'Update chord event',
            inverseAction: state
                ? {
                      type: 'restoreChordTrackState',
                      payload: { enabled: state.enabled, events: state.events.map((event) => ({ ...event })) },
                  }
                : null,
        };
    },
    undoable: true,
});
