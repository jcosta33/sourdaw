import { createStore } from '#/infra/store/createStore';
import { createAutomergeStorage } from '#/infra/store/storage/createAutomergeStorage';

import { type ChordEvent } from '../models/ChordEvent';
import { CHORD_TYPES, type ChordType } from '../models/ChordTypes';

export type ChordTrackState = {
    enabled: boolean;
    events: ChordEvent[];
};

export const defaultChordTrackState: ChordTrackState = { enabled: false, events: [] };

const DOC_PREFIX_ROOT = 'root';

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

function isChordTrackState(value: unknown): value is ChordTrackState {
    if (!isChordTrackStateCandidate(value)) {
        return false;
    }

    return typeof value.enabled === 'boolean' && Array.isArray(value.events) && value.events.every(isChordEvent);
}

function sanitizeChordTrackState(value: unknown): ChordTrackState {
    if (isChordTrackState(value)) {
        return value;
    }
    return defaultChordTrackState;
}

export const chordTrackStore = createStore<ChordTrackState>({
    storage: createAutomergeStorage(DOC_PREFIX_ROOT, 'chordTrack', {
        hydrateMissing: () => defaultChordTrackState,
    }),
    initialData: defaultChordTrackState,
    sanitize: sanitizeChordTrackState,
});
