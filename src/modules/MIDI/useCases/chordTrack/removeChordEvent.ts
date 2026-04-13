import { chordTrackStore } from '../../stores/chordTrackStore';

export function removeChordEvent(eventId: string): void {
    const state = chordTrackStore.value;
    if (!state) {
        return;
    }

    chordTrackStore.set({
        ...state,
        events: state.events.filter((e) => e.id !== eventId),
    });
}
