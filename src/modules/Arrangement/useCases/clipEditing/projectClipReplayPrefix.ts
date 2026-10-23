import { getAutomationLanes, isExactAutomationLaneSnapshots } from '#/modules/Automation/useCases';
import { shiftLoopOriginEntry } from '#/utils/clipLoopOrigin';
import { type AppAction, type ClipAutomationLaneSnapshot, type ClipSnapshot } from '#/utils/handlerContract';

import { getTrackStoreState } from '../getTrackStoreState';
import { planRippleDelete } from '../rippleDelete/planRippleDelete';

type LocatedClip = { owningTrackId: string; clip: ClipSnapshot };
type ShiftedOwnerState = {
    clips: readonly LocatedClip[];
    lanes: readonly ClipAutomationLaneSnapshot[];
};

function projectRemoval(state: ShiftedOwnerState, clipId: string, ripple?: boolean): ShiftedOwnerState | null {
    const target = state.clips.find((owner) => owner.clip.id === clipId);
    if (!target) {
        return null;
    }
    const plan = planRippleDelete(
        { trackId: target.owningTrackId, clipIds: [clipId], ripple },
        {
            tracks: [
                {
                    id: target.owningTrackId,
                    clips: state.clips
                        .filter((owner) => owner.owningTrackId === target.owningTrackId)
                        .map((owner) => owner.clip),
                },
            ],
        }
    );
    if (!plan) {
        return null;
    }
    const remaining = new Map(plan.nextClips.map((clip) => [clip.id, clip]));
    const shifts = new Map(plan.shiftedClips.map((shift) => [shift.clipId, shift.automationDelta]));
    return {
        clips: state.clips.flatMap((owner) => {
            if (owner.owningTrackId !== target.owningTrackId) {
                return [owner];
            }
            const clip = remaining.get(owner.clip.id);
            return clip ? [{ ...owner, clip }] : [];
        }),
        lanes: state.lanes
            .filter((lane) => lane.clipId !== clipId)
            .map((lane) => {
                const delta = lane.clipId === undefined ? undefined : shifts.get(lane.clipId);
                if (delta === undefined || delta === 0) {
                    return lane;
                }
                return {
                    ...lane,
                    points: lane.points
                        .map((point) => ({ ...point, beat: Math.max(0, point.beat + delta) }))
                        .sort((left, right) => left.beat - right.beat),
                };
            }),
    };
}

function insertRestoredClips(
    clips: readonly LocatedClip[],
    trackId: string,
    clipIndex: number | undefined,
    restored: readonly ClipSnapshot[],
    trackIds: readonly string[]
): readonly LocatedClip[] {
    const ownerPositions = clips.flatMap((owner, index) => (owner.owningTrackId === trackId ? [index] : []));
    const slot = clipIndex === undefined ? ownerPositions.length : Math.min(clipIndex, ownerPositions.length);
    let insertionIndex: number;
    if (slot < ownerPositions.length) {
        insertionIndex = ownerPositions[slot]!;
    } else if (ownerPositions.length > 0) {
        insertionIndex = ownerPositions[ownerPositions.length - 1]! + 1;
    } else {
        const ownerOrder = trackIds.indexOf(trackId);
        const nextTrack = clips.findIndex((owner) => trackIds.indexOf(owner.owningTrackId) > ownerOrder);
        insertionIndex = nextTrack < 0 ? clips.length : nextTrack;
    }
    const next = [...clips];
    next.splice(insertionIndex, 0, ...restored.map((clip) => ({ owningTrackId: trackId, clip })));
    return next;
}

/** Exactly the geometry and automation clip removal and `undoRippleDelete` write, in group order.
 * Restored lanes matter even when that earlier removal did not ripple: a later
 * inverse may shift the clip the earlier inverse just brought back. */
export function projectClipReplayPrefix(priorActions: readonly AppAction[] = []): ShiftedOwnerState | null {
    const tracks = getTrackStoreState()?.tracks ?? [];
    const trackIds = tracks.map((track) => track.id);
    let state: ShiftedOwnerState = {
        clips: tracks.flatMap((track) => track.clips.map((clip) => ({ owningTrackId: track.id, clip }))),
        lanes: getAutomationLanes(),
    };
    for (const action of priorActions) {
        if (action.type === 'removeClip') {
            const removal = projectRemoval(state, action.payload.clipId, action.payload.ripple);
            if (!removal) {
                return null;
            }
            state = removal;
            continue;
        }
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
        const { trackId, clipIndex, clipSnapshot, ripplePlan } = action.payload;
        const removedClips = ripplePlan?.removedClips ?? [clipSnapshot];
        const liveClipIds = new Set(state.clips.map((owner) => owner.clip.id));
        if (removedClips.some((clip) => liveClipIds.has(clip.id))) {
            return null;
        }
        if (!ripplePlan) {
            state = { ...state, clips: insertRestoredClips(state.clips, trackId, clipIndex, [clipSnapshot], trackIds) };
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
        state = {
            clips: insertRestoredClips(clips, trackId, clipIndex, ripplePlan.removedClips, trackIds),
            lanes: [...shiftedLanes, ...ripplePlan.clipAutomationLanes],
        };
    }
    return state;
}
