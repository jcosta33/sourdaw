import { getMidiInputTrack, getMidiInputTrackOwnerId } from '#/modules/MIDI/useCases';
import { createHandler } from '#/utils/createHandler';

import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { armTrack } from '../../useCases/recording/armTrack';

import type { AppAction } from '#/utils/handlerContract';

type ArmTrackAction = Extract<AppAction, { type: 'armTrack' }>;

function ensureMidiInputOwnerId(action: ArmTrackAction): string | null {
    if (action.payload.midiInputOwnerId === undefined) {
        action.payload.midiInputOwnerId = `arm-${crypto.randomUUID()}`;
    }
    return action.payload.midiInputOwnerId;
}

export const handleArmTrack = createHandler<'armTrack'>({
    execute: (action) => {
        const midiInputOwnerId = ensureMidiInputOwnerId(action);
        const runtimeEffect = armTrack(action.payload.trackId, action.payload.armed, {
            deferRuntimeEffect: true,
            midiInputTrackId: action.payload.midiInputTrackId,
            expectedMidiInputTrackId: action.payload.expectedMidiInputTrackId,
            midiInputOwnerId,
            expectedMidiInputOwnerId: action.payload.expectedMidiInputOwnerId,
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
        const currentMidiInputOwnerId = getMidiInputTrackOwnerId();
        if (
            action.payload.expectedMidiInputTrackId !== undefined &&
            currentMidiInputTrackId !== action.payload.expectedMidiInputTrackId
        ) {
            return true;
        }
        if (
            action.payload.expectedMidiInputOwnerId !== undefined &&
            currentMidiInputOwnerId !== action.payload.expectedMidiInputOwnerId
        ) {
            return true;
        }
        const desiredMidiInputOwnerId =
            action.payload.midiInputOwnerId === undefined ? null : action.payload.midiInputOwnerId;
        return (
            currentMidiInputTrackId === action.payload.midiInputTrackId &&
            currentMidiInputOwnerId === desiredMidiInputOwnerId
        );
    },
    describe: (action) => {
        const midiInputOwnerId = ensureMidiInputOwnerId(action);
        const previousTrack = getTrackStoreState()?.tracks.find((candidate) => candidate.id === action.payload.trackId);
        const previousMidiInputTrackId = getMidiInputTrack();
        const previousMidiInputOwnerId = getMidiInputTrackOwnerId();
        let expectedMidiInputTrackId = previousMidiInputTrackId;
        let expectedMidiInputOwnerId = previousMidiInputOwnerId;
        const expectedRouteMatches =
            (action.payload.expectedMidiInputTrackId === undefined ||
                previousMidiInputTrackId === action.payload.expectedMidiInputTrackId) &&
            (action.payload.expectedMidiInputOwnerId === undefined ||
                previousMidiInputOwnerId === action.payload.expectedMidiInputOwnerId);
        if (previousTrack && expectedRouteMatches) {
            let changesRuntimeRoute = false;
            if (action.payload.midiInputTrackId !== undefined) {
                expectedMidiInputTrackId = action.payload.midiInputTrackId;
                changesRuntimeRoute = true;
            } else if (action.payload.armed && previousTrack.kind === 'midi') {
                expectedMidiInputTrackId = previousTrack.id;
                changesRuntimeRoute = true;
            } else if (!action.payload.armed && previousMidiInputTrackId === previousTrack.id) {
                expectedMidiInputTrackId = null;
                changesRuntimeRoute = true;
            }
            if (changesRuntimeRoute) {
                expectedMidiInputOwnerId = midiInputOwnerId;
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
                          midiInputOwnerId: previousMidiInputOwnerId,
                          expectedMidiInputOwnerId,
                      },
                  }
                : null,
        };
    },
    previewExecution: 'isolated-project',
    requiresAbortCompensation: false,
    // `docs/manual/02-concepts.md` names arming as *the* mixer control that
    // records, so that a user seeing "Arm track" in the history panel does not
    // read it as evidence the rest of the strip is covered. That sentence is
    // load-bearing in the other direction too: if arming ever stops recording,
    // the page becomes wrong about the one exception it bothers to print.
    undoable: true,
});
