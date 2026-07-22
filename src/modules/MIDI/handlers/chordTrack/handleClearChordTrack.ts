import { createHandler } from '#/utils/createHandler';

import { chordTrackStore } from '../../stores/chordTrackStore';
import { clearChordTrack } from '../../useCases/chordTrack/clearChordTrack';

export const handleClearChordTrack = createHandler<'clearChordTrack'>({
    execute: () => {
        clearChordTrack();
    },
    describe: () => {
        const state = chordTrackStore.value;
        return {
            label: 'Clear chord track',
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
