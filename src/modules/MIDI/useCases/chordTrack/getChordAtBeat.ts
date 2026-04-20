import { type ChordEvent } from '../../models/ChordEvent';
import { chordTrackStore } from '../../stores/chordTrackStore';

/** Returns the active chord event at the given beat, or null if none. */
export function getChordAtBeat(beat: number): ChordEvent | null {
    const state = chordTrackStore.value;
    if (!state || !state.enabled || state.events.length === 0) {
        return null;
    }

    // Find the last event whose beat ≤ the query beat and whose range covers it
    for (let i = state.events.length - 1; i >= 0; i--) {
        const event = state.events[i]!;
        if (event.beat <= beat && beat < event.beat + event.duration) {
            return event;
        }
    }
    return null;
}
