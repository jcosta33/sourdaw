import { createStore } from '#/infra/store/createStore';

import { type ChordEvent } from '../models/ChordEvent';

export type ChordTrackState = {
    enabled: boolean;
    events: ChordEvent[];
};

export const defaultChordTrackState: ChordTrackState = { enabled: false, events: [] };

function isChordEvent(value: unknown): value is ChordEvent {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    const entry = value as Record<string, unknown>;
    return (
        typeof entry.id === 'string' &&
        typeof entry.beat === 'number' &&
        typeof entry.root === 'number' &&
        typeof entry.quality === 'string' &&
        typeof entry.duration === 'number'
    );
}

function isChordTrackState(value: unknown): value is ChordTrackState {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    const entry = value as Record<string, unknown>;
    return typeof entry.enabled === 'boolean' && Array.isArray(entry.events) && entry.events.every(isChordEvent);
}

function loadFromStorage(): ChordTrackState {
    try {
        const stored = window.localStorage.getItem('sourdaw_chord_track');
        if (stored) {
            const parsed: unknown = JSON.parse(stored);
            if (isChordTrackState(parsed)) {
                return parsed;
            }
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
        window.localStorage.setItem('sourdaw_chord_track', JSON.stringify(state));
    }
});
