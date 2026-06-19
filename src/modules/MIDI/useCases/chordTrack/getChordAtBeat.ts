import { type ChordEvent } from '../../models/ChordEvent';
import { chordTrackStore } from '../../stores/chordTrackStore';

/**
 * Returns the active chord event at the given beat, or null if none.
 *
 * `state.events` is maintained sorted ascending by `beat` (see addChordEvent /
 * moveChordEvent), so the search binary-searches for the last event whose
 * `beat ≤ query` instead of scanning every event end-to-start on each call. From
 * that upper bound it walks backward to the first event whose span covers the beat,
 * preserving the original "last matching event when spans overlap" behaviour.
 */
export function getChordAtBeat(beat: number): ChordEvent | null {
    const state = chordTrackStore.value;
    if (!state || !state.enabled || state.events.length === 0) {
        return null;
    }

    const events = state.events;

    // Binary search for the index of the last event whose beat ≤ the query beat.
    let low = 0;
    let high = events.length - 1;
    let upperBound = -1;
    while (low <= high) {
        const mid = (low + high) >>> 1;
        if (events[mid]!.beat <= beat) {
            upperBound = mid;
            low = mid + 1;
        } else {
            high = mid - 1;
        }
    }

    // Walk backward from the upper bound to the first event whose span covers the beat.
    for (let index = upperBound; index >= 0; index--) {
        const event = events[index]!;
        if (beat < event.beat + event.duration) {
            return event;
        }
    }
    return null;
}
