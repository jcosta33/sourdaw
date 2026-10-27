import { getAutomationLanes, isExactAutomationLaneSnapshots } from '#/modules/Automation/useCases';
import { shiftLoopOriginEntry } from '#/utils/clipLoopOrigin';
import { type AppAction, type ClipAutomationLaneSnapshot, type ClipSnapshot } from '#/utils/handlerContract';

import { type Clip, sanitizeTrackSnapshot } from '../../stores/trackStore';
import { buildDuplicateClipInput } from '../clip/buildDuplicateClipInput';
import { isClipDropCompatible } from '../clip/isClipDropCompatible';
import { getTrackStoreState } from '../getTrackStoreState';
import { planRippleDelete } from '../rippleDelete/planRippleDelete';

import { resolveClipRestoreInsertionIndex } from './resolveClipRestoreInsertionIndex';
import { resolveClipSplitInsertionIndex } from './resolveClipSplitInsertionIndex';

type LocatedClip = { owningTrackId: string; clip: ClipSnapshot & Pick<Clip, 'loopOriginBeat'> };
type ShiftedOwnerState = {
    clips: readonly LocatedClip[];
    lanes: readonly ClipAutomationLaneSnapshot[];
};

function projectDiscard(state: ShiftedOwnerState, clipId: string): ShiftedOwnerState | null {
    if (!state.clips.some((owner) => owner.clip.id === clipId)) {
        return null;
    }
    return {
        clips: state.clips.filter((owner) => owner.clip.id !== clipId),
        lanes: state.lanes.filter((lane) => lane.clipId !== clipId),
    };
}

function projectDuplicate(
    state: ShiftedOwnerState,
    payload: Extract<AppAction, { type: 'duplicateClipAt' }>['payload']
): ShiftedOwnerState | null {
    const tracks = getTrackStoreState()?.tracks ?? [];
    const source = state.clips.find((owner) => owner.clip.id === payload.clipId);
    const sourceTrack = tracks.find((track) => track.id === source?.owningTrackId);
    const destination = tracks.find((track) => track.id === payload.destinationTrackId);
    const targetClipId = payload.targetClipId;
    if (
        !source ||
        !sourceTrack ||
        !destination ||
        !targetClipId ||
        state.clips.some((owner) => owner.clip.id === targetClipId)
    ) {
        return null;
    }
    const clip = sanitizeTrackSnapshot({ tracks: [{ ...sourceTrack, clips: [source.clip] }] }).tracks[0]?.clips[0];
    if (!clip || !isClipDropCompatible(clip.type, destination.kind)) {
        return null;
    }
    const copy: Clip = {
        ...buildDuplicateClipInput(clip, {
            targetClipId,
            destinationTrackId: destination.id,
            startBeat: payload.startBeat,
        }),
        // addClip includes this unset optional in its newly produced runtime value.
        isGhost: undefined,
    };
    if (
        !Number.isFinite(copy.startBeat) ||
        !Number.isFinite(copy.endBeat) ||
        copy.startBeat < 0 ||
        copy.endBeat <= copy.startBeat
    ) {
        return null;
    }
    return {
        ...state,
        clips: insertRestoredClips(
            state.clips,
            destination.id,
            undefined,
            [copy],
            tracks.map((track) => track.id)
        ),
    };
}

function projectSplitRestore(
    state: ShiftedOwnerState,
    payload: Extract<AppAction, { type: 'restoreClipSplitState' }>['payload']
): ShiftedOwnerState | null {
    const { clipId, rightClipId, replacement } = payload;
    const trackClips = state.clips
        .filter((owner) => owner.owningTrackId === replacement.trackId && owner.clip.id !== rightClipId)
        .map((owner) => (owner.clip.id === clipId ? { ...owner, clip: replacement.leftClip } : owner));
    if (replacement.rightClip) {
        const index = resolveClipSplitInsertionIndex(
            trackClips.map((owner) => owner.clip),
            clipId,
            rightClipId,
            payload.expected,
            replacement
        );
        if (index === null) {
            return null;
        }
        trackClips.splice(index, 0, {
            owningTrackId: replacement.trackId,
            clip: replacement.rightClip,
        });
    }
    const firstIndex = state.clips.findIndex((owner) => owner.owningTrackId === replacement.trackId);
    const otherClips = state.clips.filter((owner) => owner.owningTrackId !== replacement.trackId);
    otherClips.splice(Math.max(0, firstIndex), 0, ...trackClips);
    let lanes = state.lanes;
    if (replacement.clipAutomationLanes !== undefined) {
        lanes = [...state.lanes.filter((lane) => lane.clipId !== rightClipId), ...replacement.clipAutomationLanes];
    }
    return { clips: otherClips, lanes };
}

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
        if (action.type === 'duplicateClipAt') {
            const duplicate = projectDuplicate(state, action.payload);
            if (!duplicate) {
                return null;
            }
            state = duplicate;
            continue;
        }
        if (action.type === 'discardDuplicatedClip') {
            const discard = projectDiscard(state, action.payload.clipId);
            if (!discard) {
                return null;
            }
            state = discard;
            continue;
        }
        if (action.type === 'removeClip') {
            const removal = projectRemoval(state, action.payload.clipId, action.payload.ripple);
            if (!removal) {
                return null;
            }
            state = removal;
            continue;
        }
        if (action.type === 'restoreClipSplitState') {
            const restored = projectSplitRestore(state, action.payload);
            if (!restored) {
                return null;
            }
            state = restored;
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
        const clipIndex = resolveClipRestoreInsertionIndex(
            state.clips.filter((owner) => owner.owningTrackId === trackId).map((owner) => owner.clip),
            action.payload
        );
        if (clipIndex === null) {
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
