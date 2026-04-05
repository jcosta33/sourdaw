import { chordTrackStore } from '#/modules/Arrangement/stores/chordTrackStore';
import { createChordEvent, type ChordEvent } from '#/modules/MIDI/models/ChordEvent';
import { type ChordType } from '#/modules/MIDI/useCases/chordStamps';

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
