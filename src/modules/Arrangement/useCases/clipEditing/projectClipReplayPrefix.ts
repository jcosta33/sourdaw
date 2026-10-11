import { getAutomationLanes, isExactAutomationLaneSnapshots } from '#/modules/Automation/useCases';
import { workspaceStore } from '#/modules/WorkspaceShell/stores';
import {
    type AppAction,
    type AudioSourceStateSnapshot,
    type ClipAutomationLaneSnapshot,
    type ClipSnapshot,
    type ClipStateSnapshot,
} from '#/utils/handlerContract';

import { deriveRippleDelete } from '../../services/deriveRippleDelete';
import { getTrackStoreState } from '../getTrackStoreState';

import { audioSourceAfterSlip } from './audioSourceAfterSlip';
import { audioSourceAtBeat } from './audioSourceAtBeat';

type ReplayClip = ClipSnapshot & Partial<ClipStateSnapshot>;
type RestoredReplayClip = Omit<ReplayClip, 'audioOffsetSeconds' | 'audioOffsetBeats'> & {
    audioOffsetSeconds?: number;
    audioOffsetBeats?: number;
};
type LocatedClip = { owningTrackId: string; clip: ReplayClip };
type ShiftedOwnerState = {
    clips: readonly LocatedClip[];
    lanes: readonly ClipAutomationLaneSnapshot[];
};

function withAudioSource(clip: ReplayClip, source: AudioSourceStateSnapshot): ReplayClip {
    const { audioOffsetSeconds: _sourceSeconds, audioOffsetBeats: _sourceBeats, ...restored } = clip;
    const replayClip: RestoredReplayClip = restored;
    if (source.audioOffsetSeconds !== null) {
        replayClip.audioOffsetSeconds = source.audioOffsetSeconds;
    }
    if (source.audioOffsetBeats !== null) {
        replayClip.audioOffsetBeats = source.audioOffsetBeats;
    }
    return replayClip;
}

function projectClipEdit(clip: ReplayClip, action: AppAction): ReplayClip {
    if (action.type === 'trimClipStart' && action.payload.clipId === clip.id && clip.type === 'audio') {
        const startBeat = Math.max(0, action.payload.newStartBeat);
        return withAudioSource(
            { ...clip, startBeat },
            action.payload.restoreAudioSource ?? audioSourceAtBeat(clip, startBeat)
        );
    }
    if (action.type === 'slipClipContent' && action.payload.clipId === clip.id) {
        if (action.payload.clipType === 'audio') {
            return withAudioSource(
                clip,
                action.payload.restoreAudioSource ??
                    audioSourceAfterSlip(clip, action.payload.offset, action.payload.offsetSeconds)
            );
        }
        if (action.payload.clipType === 'midi') {
            return { ...clip, midiOffsetBeats: action.payload.offset };
        }
    }
    if (action.type === 'setTempo' && action.payload.sourceTransition) {
        const transition = action.payload.sourceTransition;
        const source = transition.clips.find(
            (candidate) =>
                candidate.alternativeId === null && candidate.trackId === clip.trackId && candidate.clipId === clip.id
        );
        if (source) {
            if (transition.direction === 'apply') {
                return { ...clip, audioOffsetSeconds: source.audioOffsetSeconds };
            }
            const { audioOffsetSeconds: _removed, ...restored } = clip;
            return restored;
        }
    }
    return clip;
}

function shiftProjectedLanes(
    lanes: readonly ClipAutomationLaneSnapshot[],
    shifts: ReadonlyMap<string, { automationDelta: number }>,
    direction: 1 | -1
): readonly ClipAutomationLaneSnapshot[] {
    return lanes.map((lane) => {
        const shift = lane.clipId === undefined ? undefined : shifts.get(lane.clipId);
        if (!shift || shift.automationDelta === 0) {
            return lane;
        }
        return {
            ...lane,
            points: lane.points
                .map((point) => ({ ...point, beat: Math.max(0, point.beat + direction * shift.automationDelta) }))
                .sort((left, right) => left.beat - right.beat),
        };
    });
}

function projectRemoval(state: ShiftedOwnerState, clipId: string): ShiftedOwnerState | null {
    const owner = state.clips.find((candidate) => candidate.clip.id === clipId);
    if (!owner) {
        return null;
    }
    const plan = deriveRippleDelete({
        clips: state.clips
            .filter((candidate) => candidate.owningTrackId === owner.owningTrackId)
            .map(({ clip }) => clip),
        clipIds: [clipId],
        rippleEnabled: workspaceStore.value?.rippleEditing ?? false,
    });
    if (!plan) {
        return null;
    }
    const nextClips = new Map(plan.nextClips.map((clip) => [clip.id, clip]));
    const clips = state.clips.flatMap((candidate) => {
        if (candidate.owningTrackId !== owner.owningTrackId) {
            return [candidate];
        }
        const clip = nextClips.get(candidate.clip.id);
        return clip ? [{ ...candidate, clip }] : [];
    });
    const removedIds = new Set(plan.removedClips.map((clip) => clip.id));
    const shifts = new Map(plan.shiftedClips.map((shift) => [shift.clipId, shift]));
    const lanes = state.lanes.filter((lane) => lane.clipId === undefined || !removedIds.has(lane.clipId));
    return { clips, lanes: shiftProjectedLanes(lanes, shifts, 1) };
}

/** The clip geometry/source and automation prior replay members write, in group order.
 * Restored lanes matter even when that earlier removal did not ripple: a later
 * inverse may shift the clip the earlier inverse just brought back. */
export function projectClipReplayPrefix(priorActions: readonly AppAction[] = []): ShiftedOwnerState | null {
    const tracks = getTrackStoreState()?.tracks ?? [];
    let state: ShiftedOwnerState = {
        clips: tracks.flatMap((track) => track.clips.map((clip) => ({ owningTrackId: track.id, clip }))),
        lanes: getAutomationLanes(),
    };
    for (const action of priorActions) {
        state = {
            ...state,
            clips: state.clips.map((owner) => ({ ...owner, clip: projectClipEdit(owner.clip, action) })),
        };
        if (action.type === 'removeClip') {
            const removal = projectRemoval(state, action.payload.clipId);
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
        const shiftedLanes = shiftProjectedLanes(state.lanes, shifts, -1);
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
