import { createHandler } from '#/utils/createHandler';
import { type AppAction } from '#/utils/handlerContract';
import { valuesEqual } from '#/utils/structuralEquality';

import { type WarpState } from '../../models/WarpMarker';
import { normalizeWarpState } from '../../stores/clipSatelliteState';
import { getWarpState, setWarpState } from '../../stores/warpStates';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';

type SetClipWarpStateAction = Extract<AppAction, { type: 'setClipWarpState' }>;

const INVALID_TARGET_REASON = 'Warp state requires an existing audio clip.';
const DIVERGED_REASON = 'The clip warp state changed since this edit was captured.';

function isAudioClipTarget(clipId: string): boolean {
    return (
        getTrackStoreState()?.tracks.some((track) =>
            track.clips.some((clip) => clip.id === clipId && clip.type === 'audio')
        ) ?? false
    );
}

/** The live state as the wire carries it: stored markers can hold keys set to `undefined` that the snapshot omits. */
function readLiveWarpState(clipId: string): WarpState {
    return normalizeWarpState(getWarpState(clipId));
}

function sameWarpState(left: WarpState, right: WarpState): boolean {
    return valuesEqual(left, right);
}

function liveStateMatchesExpectation(action: SetClipWarpStateAction): boolean {
    const expected = action.payload.expectedWarpState;
    return (
        expected === undefined || sameWarpState(readLiveWarpState(action.payload.clipId), normalizeWarpState(expected))
    );
}

export const handleSetClipWarpState = createHandler<'setClipWarpState'>({
    // Conflicts when `expectedWarpState` no longer matches the live state, the guard its own inverse carries.
    canReportConflict: true,
    validate: (action) => isAudioClipTarget(action.payload.clipId) && liveStateMatchesExpectation(action),
    validationRefusalReason: (action) =>
        isAudioClipTarget(action.payload.clipId) ? DIVERGED_REASON : INVALID_TARGET_REASON,
    execute: (action) => {
        if (!isAudioClipTarget(action.payload.clipId)) {
            return { status: 'conflict', reason: INVALID_TARGET_REASON };
        }
        if (!liveStateMatchesExpectation(action)) {
            return { status: 'conflict', reason: DIVERGED_REASON };
        }
        setWarpState(action.payload.clipId, normalizeWarpState(action.payload.warpState));
        return { status: 'written' };
    },
    describe: (action) => {
        const { clipId } = action.payload;
        if (!isAudioClipTarget(clipId)) {
            return { label: 'Edit clip warp', inverseAction: null };
        }
        const previous = readLiveWarpState(clipId);
        const next = normalizeWarpState(action.payload.warpState);
        return {
            label: 'Edit clip warp',
            inverseAction: {
                type: 'setClipWarpState',
                payload: { clipId, warpState: previous, expectedWarpState: next },
            },
            redoAction: {
                type: 'setClipWarpState',
                payload: { clipId, warpState: next, expectedWarpState: previous },
            },
        };
    },
    isNoop: (action) =>
        isAudioClipTarget(action.payload.clipId) &&
        sameWarpState(readLiveWarpState(action.payload.clipId), normalizeWarpState(action.payload.warpState)),
    undoable: true,
});
