import { createStore } from '#/infra/store/createStore';

import { type ChordEvent } from '../models/ChordEvent';

export type ChordTrackState = {
    enabled: boolean;
    events: ChordEvent[];
};

export const defaultChordTrackState: ChordTrackState = { enabled: false, events: [] };

function loadFromStorage(): ChordTrackState {
    try {
        const stored = localStorage.getItem('sourdaw_chord_track');
        if (stored) {
            return JSON.parse(stored) as ChordTrackState;
        }
    } catch {
        // Fallback
    }
    return defaultChordTrackState;
}

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
