import { getAutomationLanes, isExactAutomationLaneSnapshots } from '#/modules/Automation/useCases';
import {
    readTempoAtBeat,
    readSecondsAtBeat,
    readBeatAtSamples,
    tempoMapStore,
    transportStore,
} from '#/modules/Transport/stores';
import { shiftLoopOriginEntry } from '#/utils/clipLoopOrigin';
import {
    type AppAction,
    type ClipAutomationLaneSnapshot,
    type ClipSnapshot,
    type ClipStateSnapshot,
} from '#/utils/handlerContract';
import {
    projectTempoSourceClock,
    isTempoAudioSourcePromotion,
    tempoSourcePromotionsEqual,
    type TempoSourceClock,
} from '#/utils/tempoAudioSourcePromotion';
import { valuesEqual } from '#/utils/structuralEquality';
import { DEFAULT_TEMPO_BPM } from '#/utils/tempoDefaults';

import { type Clip, type Track, sanitizeTrackSnapshot } from '../../stores/trackStore';
import { takeLaneStore } from '../../stores/takeLaneStore';
import { type TakeLane } from '../../models/TakeLane';
import { type TempoTimeline } from '../../models/TempoTimeline';
import { projectTempoAudioSources } from '../../stores/tempoAudioSources';
import { captureTempoAudioSources } from '../comping/captureTempoAudioSources';
import { projectedTakeLaneOwners } from '../comping/projectedTakeLaneOwners';
import { preparedClipSplits } from './preparedClipSplit';
import { buildDuplicateClipInput } from '../clip/buildDuplicateClipInput';
import { isClipDropCompatible } from '../clip/isClipDropCompatible';
import { getTrackStoreState } from '../getTrackStoreState';
import { planRippleDelete } from '../rippleDelete/planRippleDelete';
import { clipSplitStateRestorable } from './clipSplitStateRestorable';
import { reKeyedTakeLaneOwnersMatchStore } from '../comping/reKeyedTakeLaneOwnersMatchStore';

type LocatedClip = { owningTrackId: string; clip: ClipSnapshot & Pick<Clip, 'loopOriginBeat'> };
type ShiftedOwnerState = {
    clips: readonly LocatedClip[];
    lanes: readonly ClipAutomationLaneSnapshot[];
    tracks: readonly Track[] | null;
    takeLanes: readonly TakeLane[];
    clock: TempoSourceClock;
    timeline: TempoTimeline;
};

function capturedTimeline(clock: TempoSourceClock): TempoTimeline {
    return {
        tempoAtBeat: (beat) => readTempoAtBeat({ beat, clock }),
        secondsAtBeat: (beat) => readSecondsAtBeat({ beat, clock }),
        beatAtSeconds: (seconds) => readBeatAtSamples({ samples: seconds, sampleRate: 1, clock }),
    };
}

function tracksWithProjectedClips(state: ShiftedOwnerState): readonly Track[] | null {
    if (!state.tracks) {
        return null;
    }
    const tracks: Track[] = [];
    for (const track of state.tracks) {
        const clips: Clip[] = [];
        for (const owner of state.clips.filter((candidate) => candidate.owningTrackId === track.id)) {
            const source = track.clips.find((clip) => clip.id === owner.clip.id);
            if (!source) {
                return null;
            }
            clips.push({ ...source, ...owner.clip });
        }
        tracks.push({ ...track, clips });
    }
    return tracks;
}

function capturedClip(snapshot: ClipStateSnapshot): Clip {
    const { kneadState, overrides, ...fields } = structuredClone(snapshot);
    const clip: Clip = fields;
    if (Object.hasOwn(snapshot, 'overrides')) {
        clip.overrides = overrides ? { ...overrides } : undefined;
    }
    if (Object.hasOwn(snapshot, 'kneadState')) {
        clip.kneadState = kneadState
            ? {
                  ...kneadState,
                  blobs: kneadState.blobs.map((blob) => ({ ...blob, pitchCurveCents: [...blob.pitchCurveCents] })),
              }
            : undefined;
    }
    return clip;
}

function projectDiscard(state: ShiftedOwnerState, clipId: string): ShiftedOwnerState | null {
    if (!state.clips.some((owner) => owner.clip.id === clipId)) {
        return null;
    }
    return {
        ...state,
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
): ShiftedOwnerState {
    const { clipId, rightClipId, replacement } = payload;
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
        lanes = [...state.lanes.filter((lane) => lane.clipId !== rightClipId), ...replacement.clipAutomationLanes];
    }
    const tracks =
        state.tracks?.map((track) => {
            if (track.id !== replacement.trackId) {
                return track;
            }
            const clips = track.clips
                .filter((clip) => clip.id !== rightClipId)
                .map((clip) => (clip.id === clipId ? capturedClip(replacement.leftClip) : clip));
            if (replacement.rightClip) {
                clips.splice(replacement.rightClipIndex, 0, capturedClip(replacement.rightClip));
            }
            return { ...track, clips };
        }) ?? null;
    return { ...state, clips: otherClips, lanes, tracks };
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
        ...state,
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

/** These source writers do not yet provide a prepared value to this prefix.
 * Refuse overlapping audio combinations before effects instead of reading an
 * earlier programme as though the operation had not happened. */
function hasUnprojectedAudioSourceWrite(action: AppAction, state: ShiftedOwnerState): boolean {
    switch (action.type) {
        case 'trimClipStart':
        case 'trimClipEnd':
        case 'slipClipContent':
        case 'moveClip':
        case 'restoreClipPlacement':
        case 'reverseClip':
        case 'setClipLoop':
        case 'restoreClipLoop':
        case 'setClipLoopLength':
        case 'restoreClipLoopLength':
        case 'setClipStretchMode':
        case 'setClipStretchRatio':
        case 'restoreClipStretchState':
            return state.clips.some((owner) => owner.clip.id === action.payload.clipId && owner.clip.type === 'audio');
        case 'setCompRegion':
        case 'removeCompRegion':
        case 'restoreCompRegionInterval':
            return state.clips.some(
                (owner) =>
                    owner.owningTrackId === action.payload.trackId &&
                    owner.clip.type === 'audio' &&
                    owner.clip.endBeat > action.payload.startBeat &&
                    (action.payload.endBeat === undefined || owner.clip.startBeat < action.payload.endBeat)
            );
        case 'selectTake':
        case 'switchTrackAlternative':
            return state.clips.some(
                (owner) => owner.owningTrackId === action.payload.trackId && owner.clip.type === 'audio'
            );
        default:
            return false;
    }
}

/** Exactly the geometry and automation clip removal and `undoRippleDelete` write, in group order.
 * Restored lanes matter even when that earlier removal did not ripple: a later
 * inverse may shift the clip the earlier inverse just brought back. */
export function projectClipReplayPrefix(
    priorActions: readonly AppAction[] = [],
    initial?: {
        readonly tracks: readonly Track[];
        readonly takeLanes: readonly TakeLane[];
        readonly automationLanes: readonly ClipAutomationLaneSnapshot[];
        readonly clock: TempoSourceClock;
    }
): ShiftedOwnerState | null {
    const tracks = initial?.tracks ?? getTrackStoreState()?.tracks ?? [];
    const trackIds = tracks.map((track) => track.id);
    const clock = structuredClone(
        initial?.clock ?? {
            tempo: transportStore.value?.tempo ?? DEFAULT_TEMPO_BPM,
            changes: tempoMapStore.value?.changes ?? [],
        }
    );
    let state: ShiftedOwnerState = {
        clips: tracks.flatMap((track) => track.clips.map((clip) => ({ owningTrackId: track.id, clip }))),
        lanes: initial?.automationLanes ?? getAutomationLanes(),
        tracks,
        takeLanes: structuredClone(initial?.takeLanes ?? takeLaneStore.value?.lanes ?? []),
        clock,
        timeline: capturedTimeline(clock),
    };
    for (const action of priorActions) {
        if (hasUnprojectedAudioSourceWrite(action, state)) {
            // Older replay guards consume geometry/automation only. Keep that
            // view, while source-aware owners require a complete track view.
            state = { ...state, tracks: null };
        }
        state = { ...state, tracks: tracksWithProjectedClips(state) };
        if (action.type === 'setTempo' || action.type === 'restoreTempoEdit') {
            const { tempoChangeId, expectedBpm, bpm, audioSourcePromotion } = action.payload;
            if (
                !state.tracks ||
                tempoChangeId === undefined ||
                expectedBpm === undefined ||
                !isTempoAudioSourcePromotion(audioSourcePromotion)
            ) {
                return null;
            }
            if (action.type === 'setTempo' && bpm === expectedBpm) {
                continue;
            }
            const nextClock = projectTempoSourceClock(state.clock, [{ tempoChangeId, expectedBpm, bpm }]);
            if (!nextClock) {
                return null;
            }
            const direction = action.type === 'restoreTempoEdit' ? action.payload.sourceDirection : 'promote';
            const projected = projectTempoAudioSources(state.tracks, state.takeLanes, audioSourcePromotion, direction);
            if (!projected) {
                return null;
            }
            const originalTimeline = direction === 'promote' ? state.timeline : capturedTimeline(nextClock);
            const recaptured = captureTempoAudioSources(
                direction === 'promote' ? state.tracks : projected.tracks,
                direction === 'promote' ? state.takeLanes : projected.lanes,
                originalTimeline
            );
            if (!recaptured || !tempoSourcePromotionsEqual(recaptured, audioSourcePromotion)) {
                return null;
            }
            state = {
                ...state,
                tracks: projected.tracks,
                takeLanes: projected.lanes,
                clips: projected.tracks.flatMap((track) =>
                    track.clips.map((clip) => ({ owningTrackId: track.id, clip }))
                ),
                clock: nextClock,
                timeline: capturedTimeline(nextClock),
            };
            continue;
        }
        if (action.type === 'splitClip') {
            const prepared = preparedClipSplits.get(action);
            if (!prepared) {
                return null;
            }
            const owner = state.clips.find((candidate) => candidate.clip.id === action.payload.clipId);
            if (
                !owner ||
                owner.owningTrackId !== prepared.previous.trackId ||
                !valuesEqual(owner.clip, prepared.previous.leftClip)
            ) {
                return null;
            }
            state = projectSplitRestore(state, {
                clipId: action.payload.clipId,
                rightClipId: prepared.rightClipId,
                expected: prepared.previous,
                replacement: prepared.next,
            });
            state = { ...state, takeLanes: projectedTakeLaneOwners([action], state.takeLanes) };
            continue;
        }
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
            if (
                !state.tracks ||
                !clipSplitStateRestorable(action.payload, { tracks: state.tracks }) ||
                !reKeyedTakeLaneOwnersMatchStore(
                    action.payload.reKeyedTakeLanes ?? [],
                    action.payload.replacement.rightClip ? 'apply' : 'restore',
                    [],
                    state.takeLanes
                )
            ) {
                return null;
            }
            state = projectSplitRestore(state, action.payload);
            state = { ...state, takeLanes: projectedTakeLaneOwners([action], state.takeLanes) };
            continue;
        }
        if (action.type !== 'restoreClip') {
            continue;
        }
        const { trackId, clipIndex, clipSnapshot, ripplePlan } = action.payload;
        if (state.tracks) {
            state = {
                ...state,
                tracks: state.tracks.map((track) =>
                    track.id === trackId
                        ? {
                              ...track,
                              clips: [...track.clips, capturedClip(clipSnapshot)],
                          }
                        : track
                ),
            };
        }
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
            ...state,
            clips: insertRestoredClips(clips, trackId, clipIndex, ripplePlan.removedClips, trackIds),
            lanes: [...shiftedLanes, ...ripplePlan.clipAutomationLanes],
        };
    }
    return { ...state, tracks: tracksWithProjectedClips(state) };
}
