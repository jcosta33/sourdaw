import { isExactAutomationLaneSnapshots } from '#/modules/Automation/useCases';
import { shiftLoopOriginEntry } from '#/utils/clipLoopOrigin';
import { type AppAction } from '#/utils/handlerContract';

import { isExactClipSnapshot } from '../../stores/isExactClipSnapshot';

import { capturedClip } from './capturedClip';
import { insertRestoredClips } from './insertRestoredClips';
import { resolveClipRestoreInsertionIndex } from './resolveClipRestoreInsertionIndex';
import { type ShiftedOwnerState } from './ShiftedOwnerState';

export function projectClipRestore(
    action: Extract<AppAction, { type: 'restoreClip' }>,
    state: ShiftedOwnerState,
    trackIds: readonly string[]
): ShiftedOwnerState | null {
    const { trackId, clipSnapshot, ripplePlan } = action.payload;
    if (state.tracks) {
        if (isExactClipSnapshot(clipSnapshot, action.payload.clipId, trackId)) {
            state = {
                ...state,
                tracks: state.tracks.map((track) => {
                    if (track.id !== trackId) {
                        return track;
                    }
                    return { ...track, clips: [...track.clips, capturedClip(clipSnapshot)] };
                }),
            };
        } else {
            // The restore payload carries only clip geometry. Keep the exact
            // geometry projection below, but stop claiming a complete Clip model.
            state = { ...state, tracks: null };
        }
    }
    const removedClips = ripplePlan?.removedClips ?? [clipSnapshot];
    const liveClipIds = new Set(state.clips.map((owner) => owner.clip.id));
    if (removedClips.some((clip) => liveClipIds.has(clip.id))) {
        return null;
    }
    const clipIndex = resolveClipRestoreInsertionIndex(
        state.clips.filter((owner) => owner.owningTrackId === trackId).map((owner) => owner.clip),
        action.payload
    );
    if (clipIndex === null) {
        return null;
    }
    if (!ripplePlan) {
        return { ...state, clips: insertRestoredClips(state.clips, trackId, clipIndex, [clipSnapshot], trackIds) };
    }
    if (!isExactAutomationLaneSnapshots(ripplePlan.clipAutomationLanes)) {
        return null;
    }
    const shifts = new Map(ripplePlan.shiftedClips.map((shift) => [shift.clipId, shift]));
    const clips = state.clips.map((owner) => {
        const shift = shifts.get(owner.clip.id);
        if (!shift || owner.owningTrackId !== trackId) {
            return owner;
        }
        return {
            ...owner,
            clip: {
                ...owner.clip,
                startBeat: shift.origStartBeat,
                endBeat: shift.origEndBeat,
                ...shiftLoopOriginEntry(owner.clip, shift.origStartBeat - owner.clip.startBeat),
            },
        };
    });
    const shiftedLanes = state.lanes.map((lane) => {
        const shift = lane.clipId === undefined ? undefined : shifts.get(lane.clipId);
        if (!shift || shift.automationDelta === 0) {
            return lane;
        }
        return {
            ...lane,
            points: lane.points
                .map((point) => ({ ...point, beat: Math.max(0, point.beat - shift.automationDelta) }))
                .sort((left, right) => left.beat - right.beat),
        };
    });
    const liveIds = new Set(shiftedLanes.map((lane) => lane.id));
    if (ripplePlan.clipAutomationLanes.some((lane) => liveIds.has(lane.id))) {
        return null;
    }
    return {
        ...state,
        clips: insertRestoredClips(clips, trackId, clipIndex, ripplePlan.removedClips, trackIds),
        lanes: [...shiftedLanes, ...ripplePlan.clipAutomationLanes],
    };
}
