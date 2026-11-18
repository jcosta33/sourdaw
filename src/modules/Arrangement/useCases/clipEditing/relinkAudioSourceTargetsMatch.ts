import { type HandlerValidationContext } from '#/utils/handlerContract';

import { type RelinkTarget, RELINK_AUDIO_SOURCE_KEYS } from '../../models/RelinkAudioSourceTarget';
import { type Clip, type Track } from '../../models/Track';
import { resolveEligibleClipWriteTarget } from '../../stores/resolveEligibleClipWriteTarget';
import { type TrackStoreState, trackStore } from '../../stores/trackStore';

import { projectRelinkAudioSourceTracks } from './projectRelinkAudioSourceTracks';

function matches(track: Track, clip: Clip, target: RelinkTarget): boolean {
    if (
        track.kind !== target.trackKind ||
        track.activeAlternativeId !== target.activeAlternativeId ||
        track.frozen ||
        track.freezeState.status !== 'unfrozen' ||
        clip.locked ||
        clip.trackId !== target.trackId ||
        clip.type !== 'audio'
    ) {
        return false;
    }
    return RELINK_AUDIO_SOURCE_KEYS.every(
        (key) =>
            clip[key] === target.before[key] && (key === 'audioBufferId' || target.before[key] === target.after[key])
    );
}

function readRelinkSourceState(
    context?: HandlerValidationContext,
    sourceState = trackStore.value
): typeof trackStore.value {
    let state = sourceState;
    if (state && context && context.actionIndex > 0) {
        const tracks = projectRelinkAudioSourceTracks(state.tracks, context.actions.slice(0, context.actionIndex));
        if (!tracks) {
            return null;
        }
        state = { ...state, tracks };
    }
    return state;
}

function readRelinkTargetClips(track: Track, target: RelinkTarget, state: TrackStoreState): Clip[] | null {
    if (target.alternativeId === null) {
        const eligible = resolveEligibleClipWriteTarget({ clipId: target.clipId }, state);
        return eligible.status === 'eligible' ? track.clips : null;
    }
    if (target.alternativeId === track.activeAlternativeId) {
        return null;
    }
    const alternatives = track.alternatives.filter((item) => item.id === target.alternativeId);
    const [alternative] = alternatives;
    return alternative && alternatives.length === 1 ? alternative.clips : null;
}

function matchesTarget(state: TrackStoreState | null, target: RelinkTarget): boolean {
    if (!state) {
        return false;
    }
    const owners = state.tracks.filter((track) => track.id === target.trackId);
    const [track] = owners;
    if (!track || owners.length !== 1) {
        return false;
    }
    const eligible = resolveEligibleClipWriteTarget({ trackId: target.trackId }, state);
    if (eligible.status !== 'eligible' || eligible.trackId !== target.trackId) {
        return false;
    }
    const clips = readRelinkTargetClips(track, target, state);
    if (!clips) {
        return false;
    }
    const found = clips.filter((clip) => clip.id === target.clipId);
    const [clip] = found;
    return clip !== undefined && found.length === 1 && matches(track, clip, target);
}

export function relinkAudioSourceTargetsMatch(
    targets: readonly RelinkTarget[],
    context?: HandlerValidationContext,
    sourceState?: TrackStoreState | null
): boolean {
    const state = readRelinkSourceState(context, sourceState);
    if (targets.length === 0) {
        return false;
    }
    const keys = new Set<string>();
    for (const target of targets) {
        if (
            target.before.audioBufferId === target.after.audioBufferId ||
            target.before.audioBufferId === '' ||
            target.after.audioBufferId === ''
        ) {
            return false;
        }
        const key = JSON.stringify([target.trackId, target.alternativeId, target.clipId]);
        if (keys.has(key)) {
            return false;
        }
        keys.add(key);
        if (!matchesTarget(state, target)) {
            return false;
        }
    }
    return true;
}
