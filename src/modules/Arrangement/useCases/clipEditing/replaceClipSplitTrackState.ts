import { type ClipStateSnapshot } from '#/utils/handlerContract';

import { getTrackState } from '../../repositories/track/getTrackState';
import { setTrackState } from '../../repositories/track/setTrackState';
import { type Clip } from '../../stores/trackStore';

import { clipSplitStateRestorable, type ClipSplitStateRestorableInput } from './clipSplitStateRestorable';

function cloneClip(snapshot: ClipStateSnapshot): Clip {
    const { overrides, kneadState, ...snapshotClip } = structuredClone(snapshot);
    const clip: Clip = snapshotClip;
    if (Object.hasOwn(snapshot, 'overrides')) {
        clip.overrides = overrides ? { ...overrides } : undefined;
    }
    if (Object.hasOwn(snapshot, 'kneadState')) {
        clip.kneadState = kneadState
            ? {
                  ...kneadState,
                  blobs: kneadState.blobs.map((blob) => ({
                      ...blob,
                      pitchCurveCents: [...blob.pitchCurveCents],
                  })),
              }
            : undefined;
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
