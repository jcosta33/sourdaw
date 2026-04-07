import { createStore } from '#/infra/store/createStore';
import { type ChordEvent } from '#/modules/MIDI/models/ChordEvent';

export type ChordTrackState = {
    enabled: boolean;
    events: ChordEvent[];
};

const loadFromStorage = (): ChordTrackState => {
    try {
        const stored = localStorage.getItem('sourdaw_chord_track');
        if (stored) {
            return JSON.parse(stored) as ChordTrackState;
        }
    } catch {
        // Fallback
    }
    return { enabled: false, events: [] };
};

export const chordTrackStore = createStore<ChordTrackState>({
    initialData: loadFromStorage(),
});

/** Persist chord track state to localStorage on every change. */
chordTrackStore.subscribe(() => {
    const state = chordTrackStore.value;
    if (state) {
        localStorage.setItem('sourdaw_chord_track', JSON.stringify(state));
    }
});
