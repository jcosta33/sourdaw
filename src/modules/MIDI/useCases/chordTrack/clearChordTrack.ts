import { chordTrackStore } from '../../stores/chordTrackStore';

export function clearChordTrack(): void {
    const state = chordTrackStore.value;
    if (!state) {
        return;
    }
    chordTrackStore.set({ ...state, events: [] });
}
