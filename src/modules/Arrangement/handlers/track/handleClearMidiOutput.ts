import { createHandler } from '#/utils/createHandler';

import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { updateTrack } from '../../useCases/updateTrack';

export const handleClearMidiOutput = createHandler<'clearMidiOutput'>({
    execute: (alpha) => {
        updateTrack(alpha.payload.trackId, (track) => ({ ...track, midiOutputTrackId: null }));
    },
    describe: (alpha) => {
        const track = getTrackStoreState()?.tracks.find((candidate) => candidate.id === alpha.payload.trackId);
        return {
            label: 'Clear MIDI Output',
            inverseAction: track
                ? {
                      type: 'restoreMidiOutput',
                      payload: {
                          trackId: track.id,
                          // Guard on the cleared route, not just on the prior
                          // destination: a route set again between the clear and the
                          // undo must conflict rather than be overwritten.
                          expected: null,
                          replacement: track.midiOutputTrackId,
                      },
                  }
                : null,
            redoAction: track
                ? {
                      type: 'restoreMidiOutput',
                      payload: {
                          trackId: track.id,
                          expected: track.midiOutputTrackId,
                          replacement: null,
                      },
                  }
                : alpha,
        };
    },
    isNoop: (action) =>
        getTrackStoreState()?.tracks.find((track) => track.id === action.payload.trackId)?.midiOutputTrackId === null,
    undoable: true,
});
