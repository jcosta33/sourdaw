import { type Clip, type Track, trackStore } from './trackStore';

/**
 * Efficient single-clip update. Owned by Arrangement (mutates `trackStore`'s
 * authoritative state). Colocated with the store — NOT in `useCases/` — so
 * cross-module writers (Knead, MIDI pattern-instance ops) can update a clip
 * without importing `Arrangement/useCases` and re-forming the barrel cycles
 * those writers previously closed.
 *
 * Only clones the one containing track and its clips array — avoids the
 * full-project re-map that a naive `trackStore.set({...state, tracks: ...})`
 * incurs.
 */
export function updateClipInStore(clipId: string, updater: (clip: Clip) => Clip): void {
    const state = trackStore.value;
    if (!state) {
        return;
    }

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
