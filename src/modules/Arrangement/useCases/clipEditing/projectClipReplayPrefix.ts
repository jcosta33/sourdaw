import { getAutomationLanes, isExactAutomationLaneSnapshots } from '#/modules/Automation/useCases';
import { type AppAction, type ClipSnapshot } from '#/utils/handlerContract';

import { getTrackStoreState } from '../getTrackStoreState';

type LocatedClip = { owningTrackId: string; clip: ClipSnapshot };
type ShiftedOwnerState = {
    clips: readonly LocatedClip[];
    lanes: ReturnType<typeof getAutomationLanes>;
};

/** Exactly the geometry and automation `undoRippleDelete` writes, in group order.
 * Restored lanes matter even when that earlier removal did not ripple: a later
 * inverse may shift the clip the earlier inverse just brought back. */
export function projectClipReplayPrefix(priorActions: readonly AppAction[] = []): ShiftedOwnerState | null {
    const tracks = getTrackStoreState()?.tracks ?? [];
    let state: ShiftedOwnerState = {
        clips: tracks.flatMap((track) => track.clips.map((clip) => ({ owningTrackId: track.id, clip }))),
        lanes: getAutomationLanes(),
    };
    for (const action of priorActions) {
        if (action.type === 'restoreClipSplitState') {
            const { clipId, rightClipId, replacement } = action.payload;
            const trackClips = state.clips
                .filter((owner) => owner.owningTrackId === replacement.trackId && owner.clip.id !== rightClipId)
                .map((owner) => (owner.clip.id === clipId ? { ...owner, clip: replacement.leftClip } : owner));
            if (replacement.rightClip) {
                trackClips.splice(replacement.rightClipIndex, 0, {
                    owningTrackId: replacement.trackId,
                    clip: replacement.rightClip,
                });
            }
            const firstIndex = state.clips.findIndex((owner) => owner.owningTrackId === replacement.trackId);
            const otherClips = state.clips.filter((owner) => owner.owningTrackId !== replacement.trackId);
            otherClips.splice(Math.max(0, firstIndex), 0, ...trackClips);
            let lanes = state.lanes;
            if (replacement.clipAutomationLanes !== undefined) {
                lanes = [
                    ...state.lanes.filter((lane) => lane.clipId !== rightClipId),
                    ...replacement.clipAutomationLanes,
                ];
            }
            state = { clips: otherClips, lanes };
            continue;
        }
        if (action.type !== 'restoreClip') {
            continue;
        }
        const { trackId, clipSnapshot, ripplePlan } = action.payload;
        const removedClips = ripplePlan?.removedClips ?? [clipSnapshot];
        const liveClipIds = new Set(state.clips.map((owner) => owner.clip.id));
        if (removedClips.some((clip) => liveClipIds.has(clip.id))) {
            return null;
        }
        if (!ripplePlan) {
            state = { ...state, clips: [...state.clips, { owningTrackId: trackId, clip: clipSnapshot }] };
            continue;
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
            return { ...owner, clip: { ...owner.clip, startBeat: shift.origStartBeat, endBeat: shift.origEndBeat } };
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
        state = {
            clips: [...clips, ...ripplePlan.removedClips.map((clip) => ({ owningTrackId: trackId, clip }))],
            lanes: [...shiftedLanes, ...ripplePlan.clipAutomationLanes],
        };
    }
    return state;
}
