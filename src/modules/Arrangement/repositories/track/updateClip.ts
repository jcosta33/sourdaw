import { type Clip, type Track } from '../../models/Track';
import { resolveEligibleClipWriteTarget } from '../../stores/resolveEligibleClipWriteTarget';
import { trackStore } from '../../stores/trackStore';

/**
 * Update a single clip by id across all tracks.
 *
 * §107.5 — only clone the one track that actually contains the clip,
 * plus a shallow-cloned tracks array. Previously this shallow-cloned
 * every track and every clip array even though we're touching exactly
 * one clip — recording finalize fires updateClip up to 2× per armed
 * track and paid a full-project clone per call.
 */
export function updateClip(clipId: string, updater: (clip: Clip) => Clip): boolean {
    const target = resolveEligibleClipWriteTarget({ clipId });
    if (target.status !== 'eligible' || !('clipId' in target)) {
        return false;
    }

    const state = trackStore.value;
    if (!state) {
        return false;
    }

    const trackIdx = state.tracks.findIndex((track) => track.id === target.trackId);
    if (trackIdx === -1) {
        return false;
    }

    const targetTrack = state.tracks[trackIdx]!;
    const clipIdx = targetTrack.clips.findIndex((clip) => clip.id === target.clipId);
    if (clipIdx === -1) {
        return false;
    }

    const updatedClip = updater(targetTrack.clips[clipIdx]!);
    const nextClips = targetTrack.clips.slice();
    nextClips[clipIdx] = updatedClip;

    const nextTracks: Track[] = state.tracks.slice();
    nextTracks[trackIdx] = { ...targetTrack, clips: nextClips };

    trackStore.set({ ...state, tracks: nextTracks });
    return true;
}
