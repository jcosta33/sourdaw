import { createHandler } from '#/utils/createHandler';

import { chordTrackStore } from '../../stores/chordTrackStore';
import { removeChordEvent } from '../../useCases/chordTrack/removeChordEvent';

export const handleRemoveChordEvent = createHandler<'removeChordEvent'>({
    execute: (alpha) => {
        removeChordEvent(alpha.payload.eventId);
    },
    describe: () => {
        const state = chordTrackStore.value;
        return {
            label: 'Remove chord event',
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
