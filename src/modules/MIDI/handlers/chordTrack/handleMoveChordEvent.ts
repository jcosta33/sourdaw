import { createHandler } from '#/utils/createHandler';

import { chordTrackStore } from '../../stores/chordTrackStore';
import { moveChordEvent } from '../../useCases/chordTrack/moveChordEvent';

export const handleMoveChordEvent = createHandler<'moveChordEvent'>({
    execute: (action) => {
        moveChordEvent(action.payload.eventId, action.payload.beat);
    },
    describe: () => {
        const state = chordTrackStore.value;
        return {
            label: 'Move chord event',
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
