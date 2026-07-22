import { createStore } from '#/infra/store/createStore';

import { type ChordEvent } from '../models/ChordEvent';
import { CHORD_TYPES, type ChordType } from '../models/ChordTypes';

export type ChordTrackState = {
    enabled: boolean;
    events: ChordEvent[];
};

export const defaultChordTrackState: ChordTrackState = { enabled: false, events: [] };

const STORAGE_KEY = 'sourdaw_chord_track';

type ChordEventCandidate = {
    beat?: unknown;
    duration?: unknown;
    id?: unknown;
    quality?: unknown;
    root?: unknown;
};

type ChordTrackStateCandidate = {
    enabled?: unknown;
    events?: unknown;
};

function isChordEventCandidate(value: unknown): value is ChordEventCandidate {
    return typeof value === 'object' && value !== null;
}

function isChordTrackStateCandidate(value: unknown): value is ChordTrackStateCandidate {
    return typeof value === 'object' && value !== null;
}

function isFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

function isNonNegativeFiniteNumber(value: unknown): value is number {
    return isFiniteNumber(value) && value >= 0;
}

function isRootValue(value: unknown): value is number {
    return isFiniteNumber(value) && Number.isInteger(value) && value >= 0 && value <= 11;
}

function isDurationValue(value: unknown): value is number {
    return isFiniteNumber(value) && value >= 0.25;
}

function isChordType(value: unknown): value is ChordType {
    if (typeof value !== 'string') {
        return false;
    }

    return Object.hasOwn(CHORD_TYPES, value);
}

function isChordEvent(value: unknown): value is ChordEvent {
    if (!isChordEventCandidate(value)) {
        return false;
    }

    return (
        typeof value.id === 'string' &&
        isNonNegativeFiniteNumber(value.beat) &&
        isRootValue(value.root) &&
        isChordType(value.quality) &&
        isDurationValue(value.duration)
    );
}

export function isChordTrackState(value: unknown): value is ChordTrackState {
    if (!isChordTrackStateCandidate(value)) {
        return false;
    }

    return typeof value.enabled === 'boolean' && Array.isArray(value.events) && value.events.every(isChordEvent);
}

function getStorage(): Storage | null {
    try {
        if (typeof window === 'undefined') {
            return null;
        }

        return window.localStorage;
    } catch {
        return null;
    }
}

function loadFromStorage(): ChordTrackState {
    const storage = getStorage();
    if (!storage) {
        return defaultChordTrackState;
    }

    try {
        const stored = storage.getItem(STORAGE_KEY);
        if (stored === null) {
            return defaultChordTrackState;
        }

        const parsed: unknown = JSON.parse(stored);
        if (isChordTrackState(parsed)) {
            return parsed;
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
    const storage = getStorage();
    if (!state || !storage) {
        return;
    }

    try {
        storage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
        // Persistence is best effort.
    }
});
