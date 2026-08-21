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
        const track = getTrackStoreState()?.tracks.find((candidate) => candidate.id === alpha.payload.trackId);
        return {
            label: 'Set MIDI Output',
            inverseAction: track
                ? {
                      type: 'restoreMidiOutput',
                      payload: {
                          trackId: track.id,
                          expected: alpha.payload.destinationTrackId,
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
                          replacement: alpha.payload.destinationTrackId,
                      },
                  }
                : alpha,
        };
    },
    isNoop: (action) =>
        getTrackStoreState()?.tracks.find((track) => track.id === action.payload.trackId)?.midiOutputTrackId ===
        action.payload.destinationTrackId,
    undoable: true,
});
