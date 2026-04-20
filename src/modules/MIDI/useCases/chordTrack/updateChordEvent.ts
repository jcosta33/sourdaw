import { type ChordEvent } from '../../models/ChordEvent';
import { chordTrackStore } from '../../stores/chordTrackStore';

export function updateChordEvent(
    eventId: string,
    partial: Partial<Pick<ChordEvent, 'root' | 'quality' | 'duration'>>
): void {
    const state = chordTrackStore.value;
    if (!state) {
        return;
    }

    const events = state.events.map((e) =>
        e.id === eventId
            ? {
                  ...e,
                  ...(partial.root !== undefined ? { root: partial.root % 12 } : {}),
                  ...(partial.quality !== undefined ? { quality: partial.quality } : {}),
                  ...(partial.duration !== undefined ? { duration: Math.max(0.25, partial.duration) } : {}),
              }
            : e
    );

    chordTrackStore.set({ ...state, events });
}
