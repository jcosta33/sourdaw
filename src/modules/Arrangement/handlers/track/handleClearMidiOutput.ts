import { createHandler } from '#/utils/createHandler';

import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { updateTrack } from '../../useCases/updateTrack';

export const handleClearMidiOutput = createHandler<'clearMidiOutput'>({
    execute: (alpha) => {
        updateTrack(alpha.payload.trackId, (track) => ({ ...track, midiOutputTrackId: null }));
    },
    describe: (alpha) => {
        const prev = getTrackStoreState()?.tracks.find((t) => t.id === alpha.payload.trackId);
        return {
            label: 'Clear MIDI Output',
            inverseAction:
                prev && prev.midiOutputTrackId
                    ? {
                          type: 'setMidiOutput',
                          payload: {
                              trackId: alpha.payload.trackId,
                              destinationTrackId: prev.midiOutputTrackId,
                          },
                      }
                    : null,
            redoAction: alpha,
        };
    },
    undoable: true,
});
