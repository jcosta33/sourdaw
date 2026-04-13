import { chordTrackStore } from '../../stores/chordTrackStore';
import { createChordEvent, type ChordEvent } from '../../models/ChordEvent';
import { type ChordType } from '../chordStamps/helpers';

export function addChordEvent(beat: number, root: number, quality: ChordType, duration: number): ChordEvent | null {
    const state = chordTrackStore.value;
    if (!state) {
        return null;
    }

    const event = createChordEvent(beat, root, quality, duration);
    const events = [...state.events, event].sort((a, b) => a.beat - b.beat);

    chordTrackStore.set({ ...state, events });
    return event;
}
