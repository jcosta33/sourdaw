import { getMidiInputTrack } from '#/modules/MIDI/useCases';
import { createHandler } from '#/utils/createHandler';

import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { armTrack } from '../../useCases/recording/armTrack';

export const handleArmTrack = createHandler<'armTrack'>({
    execute: (action) => {
        const runtimeEffect = armTrack(action.payload.trackId, action.payload.armed, {
            deferRuntimeEffect: true,
            midiInputTrackId: action.payload.midiInputTrackId,
            expectedMidiInputTrackId: action.payload.expectedMidiInputTrackId,
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
        if (!track || track.armed !== action.payload.armed) {
            return false;
        }
        if (action.payload.midiInputTrackId === undefined) {
            return true;
        }

        const currentMidiInputTrackId = getMidiInputTrack();
        if (
            action.payload.expectedMidiInputTrackId !== undefined &&
            currentMidiInputTrackId !== action.payload.expectedMidiInputTrackId
        ) {
            return true;
        }
        return currentMidiInputTrackId === action.payload.midiInputTrackId;
    },
    describe: (action) => {
        const previousTrack = getTrackStoreState()?.tracks.find((candidate) => candidate.id === action.payload.trackId);
        const previousMidiInputTrackId = getMidiInputTrack();
        let expectedMidiInputTrackId = previousMidiInputTrackId;
        const expectedRouteMatches =
            action.payload.expectedMidiInputTrackId === undefined ||
            previousMidiInputTrackId === action.payload.expectedMidiInputTrackId;
        if (previousTrack && expectedRouteMatches) {
            if (action.payload.midiInputTrackId !== undefined) {
                expectedMidiInputTrackId = action.payload.midiInputTrackId;
            } else if (action.payload.armed && previousTrack.kind === 'midi') {
                expectedMidiInputTrackId = previousTrack.id;
            } else if (!action.payload.armed && previousMidiInputTrackId === previousTrack.id) {
                expectedMidiInputTrackId = null;
            }
        }

        return {
            label: action.payload.armed ? 'Arm track' : 'Disarm track',
            inverseAction: previousTrack
                ? {
                      type: 'armTrack',
                      payload: {
                          trackId: previousTrack.id,
                          armed: previousTrack.armed,
                          midiInputTrackId: previousMidiInputTrackId,
                          expectedMidiInputTrackId,
                      },
                  }
                : null,
        };
    },
    requiresAbortCompensation: false,
    undoable: true,
});
