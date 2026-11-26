import { compareChordEvents, createChordEvent, type ChordEvent } from '../../models/ChordEvent';
import { type ChordType } from '../../models/ChordTypes';
import { chordTrackStore } from '../../stores/chordTrackStore';

export function addChordEvent(
    beat: number,
    root: number,
    quality: ChordType,
    duration: number,
    eventId?: string
): ChordEvent | null {
    const state = chordTrackStore.value;
    if (!state) {
        return null;
    }

    const createdEvent = createChordEvent(beat, root, quality, duration);
    const event = eventId ? { ...createdEvent, id: eventId } : createdEvent;
    const events = [...state.events, event].sort(compareChordEvents);

    chordTrackStore.set({ ...state, events });
    return event;
}
