import { chordTrackStore } from '../../stores/chordTrackStore';

export function moveChordEvent(eventId: string, newBeat: number): void {
    const state = chordTrackStore.value;
    if (!state) {
        return;
    }

    const events = state.events
        .map((event) => (event.id === eventId ? { ...event, beat: Math.max(0, newBeat) } : event))
        .sort((alpha, b) => alpha.beat - b.beat);

    chordTrackStore.set({ ...state, events });
}
