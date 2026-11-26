import { compareChordEvents } from '../../models/ChordEvent';
import { chordTrackStore } from '../../stores/chordTrackStore';

export function moveChordEvent(eventId: string, newBeat: number): void {
    const state = chordTrackStore.value;
    if (!state) {
        return;
    }

    const events = state.events
        .map((event) => (event.id === eventId ? { ...event, beat: Math.max(0, newBeat) } : event))
        .sort(compareChordEvents);

    chordTrackStore.set({ ...state, events });
}
