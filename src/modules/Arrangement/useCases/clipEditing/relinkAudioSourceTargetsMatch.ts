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
        const owners = state?.tracks.filter((track) => track.id === target.trackId) ?? [];
        if (owners.length !== 1) {
            return false;
        }
        const track = owners[0]!;
        const eligible = resolveEligibleClipWriteTarget({ trackId: target.trackId }, state);
        if (eligible.status !== 'eligible' || eligible.trackId !== target.trackId) {
            return false;
        }
        let clips = track.clips;
        if (target.alternativeId !== null) {
            if (target.alternativeId === track.activeAlternativeId) {
                return false;
            }
            const alternatives = track.alternatives.filter((item) => item.id === target.alternativeId);
            if (alternatives.length !== 1) {
                return false;
            }
            clips = alternatives[0]!.clips;
        } else if (resolveEligibleClipWriteTarget({ clipId: target.clipId }, state).status !== 'eligible') {
            return false;
        }
        const found = clips.filter((clip) => clip.id === target.clipId);
        if (found.length !== 1 || !matches(track, found[0]!, target)) {
            return false;
        }
    }
    return true;
}
