import { createHandler } from '#/utils/createHandler';

import { chordTrackStore } from '../../stores/chordTrackStore';
import { restoreChordTrackState } from '../../useCases/chordTrack/restoreChordTrackState';

export const handleRestoreChordTrackState = createHandler<'restoreChordTrackState'>({
    execute: (action) => {
        restoreChordTrackState(action.payload);
    },
    describe: () => {
        const state = chordTrackStore.value;
        return {
            label: 'Restore chord track state',
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
