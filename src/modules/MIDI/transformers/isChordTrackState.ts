import { type ChordEvent } from '../models/ChordEvent';
import { CHORD_TYPES, type ChordType } from '../models/ChordTypes';

type ChordTrackShape = { enabled: boolean; events: ChordEvent[] };

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

export function isChordEvent(value: unknown): value is ChordEvent {
    if (!isChordEventCandidate(value)) {
        return false;
    }

    return (
        typeof value.id === 'string' &&
        value.id.length > 0 &&
        isNonNegativeFiniteNumber(value.beat) &&
        isRootValue(value.root) &&
        isChordType(value.quality) &&
        isDurationValue(value.duration)
    );
}

/** The one definition of a well-formed chord track, shared by the store and by saved-entry replay validation. */
export function isChordTrackState(value: unknown): value is ChordTrackShape {
    if (!isChordTrackStateCandidate(value)) {
        return false;
    }

    if (typeof value.enabled !== 'boolean' || !Array.isArray(value.events) || !value.events.every(isChordEvent)) {
        return false;
    }
    return new Set(value.events.map((event) => event.id)).size === value.events.length;
}
