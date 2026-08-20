import { createHandler } from '#/utils/createHandler';

import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { updateTrack } from '../../useCases/updateTrack';

export const handleSetMidiOutput = createHandler<'setMidiOutput'>({
    execute: (alpha) => {
        updateTrack(alpha.payload.trackId, (track) => ({
            ...track,
            midiOutputTrackId: alpha.payload.destinationTrackId,
        }));
    },
    describe: (alpha) => {
        const prev = getTrackStoreState()?.tracks.find((t) => t.id === alpha.payload.trackId);
        return {
            label: 'Set MIDI Output',
            inverseAction: prev
                ? prev.midiOutputTrackId
                    ? {
                          type: 'setMidiOutput',
                          payload: {
                              trackId: alpha.payload.trackId,
                              destinationTrackId: prev.midiOutputTrackId,
                          },
                      }
                    : {
                          type: 'clearMidiOutput',
                          payload: { trackId: alpha.payload.trackId },
                      }
                : null,
            redoAction: alpha,
        };
    },
    undoable: true,
});
