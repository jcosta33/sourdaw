import { chordTrackStore } from '#/modules/Arrangement/stores';

export function moveChordEvent(eventId: string, newBeat: number): void {
    const state = chordTrackStore.value;
    if (!state) {
        return;
    }

    const events = state.events
        .map((e) => (e.id === eventId ? { ...e, beat: Math.max(0, newBeat) } : e))
        .sort((a, b) => a.beat - b.beat);

    chordTrackStore.set({ ...state, events });
}
