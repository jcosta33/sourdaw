import { createChordEvent, type ChordEvent } from '../../models/ChordEvent';
import { type ChordType } from '../../models/ChordTypes';
import { chordTrackStore } from '../../stores/chordTrackStore';

export function addChordEvent(beat: number, root: number, quality: ChordType, duration: number): ChordEvent | null {
    const state = chordTrackStore.value;
    if (!state) {
        return null;
    }

    const event = createChordEvent(beat, root, quality, duration);
    const events = [...state.events, event].sort((alpha, b) => alpha.beat - b.beat);

    chordTrackStore.set({ ...state, events });
    return event;
}
