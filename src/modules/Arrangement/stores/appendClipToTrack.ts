import { type Clip, type Track, trackStore } from './trackStore';

/**
 * Append a clip to a specific track. Owned by Arrangement, colocated with
 * `trackStore` so MIDI's pattern-instance creation can add a clip without
 * pulling `Arrangement/useCases`' broader graph (which would re-form
 * MIDI ↔ Arrangement cycles).
 */
export function appendClipToTrack(trackId: string, clip: Clip): void {
    const state = trackStore.value;
    if (!state) {
        return;
    }
    const trackIdx = state.tracks.findIndex((t: Track) => t.id === trackId);
    if (trackIdx === -1) {
        return;
    }
    const target = state.tracks[trackIdx]!;
    const nextTracks = state.tracks.slice();
    nextTracks[trackIdx] = { ...target, clips: [...target.clips, clip] };
    trackStore.set({ ...state, tracks: nextTracks });
}
