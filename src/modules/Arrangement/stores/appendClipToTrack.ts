import { resolveEligibleClipWriteTarget } from './resolveEligibleClipWriteTarget';
import { type Clip, type Track, trackStore } from './trackStore';

/**
 * Append a clip to a specific track. Owned by Arrangement, colocated with
 * `trackStore` so MIDI's pattern-instance creation can add a clip without
 * pulling `Arrangement/useCases`' broader graph (which would re-form
 * MIDI ↔ Arrangement cycles).
 */
export function appendClipToTrack(trackId: string, clip: Clip): boolean {
    const target = resolveEligibleClipWriteTarget({ trackId });
    if (target.status !== 'eligible') {
        return false;
    }

    if (clip.id.length === 0 || clip.trackId !== target.trackId) {
        return false;
    }

    const existingClip = resolveEligibleClipWriteTarget({ clipId: clip.id });
    if (existingClip.status !== 'missing') {
        return false;
    }

    const state = trackStore.value;
    if (!state) {
        return false;
    }
    const trackIdx = state.tracks.findIndex((track: Track) => track.id === target.trackId);
    if (trackIdx === -1) {
        return false;
    }
    const targetTrack = state.tracks[trackIdx]!;
    const nextTracks = state.tracks.slice();
    nextTracks[trackIdx] = { ...targetTrack, clips: [...targetTrack.clips, clip] };
    trackStore.set({ ...state, tracks: nextTracks });
    return true;
}
