import { type ClipStateSnapshot } from '#/utils/handlerContract';

import { getTrackState } from '../../repositories/track/getTrackState';
import { setTrackState } from '../../repositories/track/setTrackState';
import { type Clip } from '../../stores/trackStore';

import { clipSplitStateRestorable, type ClipSplitStateRestorableInput } from './clipSplitStateRestorable';

function cloneClip(snapshot: ClipStateSnapshot): Clip {
    const { overrides, kneadState, ...fields } = structuredClone(snapshot);
    const clip: Clip = fields;
    if (Object.hasOwn(snapshot, 'overrides')) {
        clip.overrides = structuredClone(overrides);
    }
    if (Object.hasOwn(snapshot, 'kneadState')) {
        clip.kneadState = undefined;
        if (kneadState) {
            clip.kneadState = {
                ...kneadState,
                blobs: kneadState.blobs.map((blob) => ({
                    ...blob,
                    pitchCurveCents: [...blob.pitchCurveCents],
                })),
            };
        }
    }
    return clip;
}

export function replaceClipSplitTrackState(input: ClipSplitStateRestorableInput): boolean {
    const { clipId, rightClipId, replacement } = input;
    const state = getTrackState();
    if (!clipSplitStateRestorable(input, state)) {
        return false;
    }
    const track = state?.tracks.find((candidate) => candidate.id === replacement.trackId);
    if (!state || !track) {
        return false;
    }

    const clips = track.clips
        .filter((clip) => clip.id !== rightClipId)
        .map((clip) => (clip.id === clipId ? cloneClip(replacement.leftClip) : clip));
    if (replacement.rightClip) {
        clips.splice(replacement.rightClipIndex, 0, cloneClip(replacement.rightClip));
    }
    setTrackState({
        ...state,
        tracks: state.tracks.map((candidate) => (candidate.id === track.id ? { ...candidate, clips } : candidate)),
    });
    return true;
}
