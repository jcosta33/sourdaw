import { resolveEligibleClipWriteTarget } from './resolveEligibleClipWriteTarget';
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
export function updateClipInStore(clipId: string, updater: (clip: Clip) => Clip): boolean {
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
