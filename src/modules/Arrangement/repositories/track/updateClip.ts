import { type Clip, type Track } from '../../models/Track';
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
export function updateClip(clipId: string, updater: (clip: Clip) => Clip): void {
    const state = trackStore.value;
    if (!state) {
        return;
    }

    // Locate the containing track + clip index without cloning.
    let trackIdx = -1;
    let clipIdx = -1;
    for (let i = 0; i < state.tracks.length; i++) {
        const t = state.tracks[i]!;
        const j = t.clips.findIndex((c) => c.id === clipId);
        if (j !== -1) {
            trackIdx = i;
            clipIdx = j;
            break;
        }
    }
    if (trackIdx === -1) {
        return;
    }

    const targetTrack = state.tracks[trackIdx]!;
    const updatedClip = updater(targetTrack.clips[clipIdx]!);
    const nextClips = targetTrack.clips.slice();
    nextClips[clipIdx] = updatedClip;

    const nextTracks: Track[] = state.tracks.slice();
    nextTracks[trackIdx] = { ...targetTrack, clips: nextClips };

    trackStore.set({ ...state, tracks: nextTracks });
}
