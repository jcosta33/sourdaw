import { getMidiInputTrack } from '#/modules/MIDI/useCases';
import { createHandler } from '#/utils/createHandler';

import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { armTrack } from '../../useCases/recording/armTrack';

export const handleArmTrack = createHandler<'armTrack'>({
    execute: (action) => {
        const runtimeEffect = armTrack(action.payload.trackId, action.payload.armed, {
            deferRuntimeEffect: true,
            midiInputTrackId: action.payload.midiInputTrackId,
        });
        if (!runtimeEffect) {
            return { status: 'no-write' };
        }
        return {
            status: 'written',
            afterCommit: runtimeEffect.afterCommit,
            afterAmbiguousCommit: runtimeEffect.afterAmbiguousCommit,
        };
    },
    isNoop: (action) => {
        const track = getTrackStoreState()?.tracks.find((candidate) => candidate.id === action.payload.trackId);
        return track?.armed === action.payload.armed;
    },
    describe: (action) => {
        const previousTrack = getTrackStoreState()?.tracks.find((candidate) => candidate.id === action.payload.trackId);
        return {
            label: action.payload.armed ? 'Arm track' : 'Disarm track',
            inverseAction: previousTrack
                ? {
                      type: 'armTrack',
                      payload: {
                          trackId: previousTrack.id,
                          armed: previousTrack.armed,
                          midiInputTrackId: getMidiInputTrack(),
                      },
                  }
                : null,
        };
    },
    requiresAbortCompensation: false,
    undoable: true,
});
