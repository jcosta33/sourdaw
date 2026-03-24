import { chordTrackStore } from '#/modules/Arrangement/stores/chordTrackStore';

export function toggleChordTrack(enabled?: boolean): void {
    const state = chordTrackStore.value;
    if (!state) {
        return;
    }
    chordTrackStore.set({ ...state, enabled: enabled ?? !state.enabled });
}
