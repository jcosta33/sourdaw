type JsonRecord = Record<string, unknown>;

export type CanonicalSerializedAddNote = {
    id: string;
    pitch: number;
    startBeat: number;
    duration: number;
    velocity: number;
    probability: 100;
};

export type CanonicalSerializedAddNotesArguments = {
    clipId: string;
    notes: CanonicalSerializedAddNote[];
};

const CANONICAL_ADD_NOTES_ARGUMENT_KEYS = ['clipId', 'notes'] as const;
const CANONICAL_ADD_NOTE_KEYS = ['duration', 'id', 'pitch', 'probability', 'startBeat', 'velocity'] as const;

function isRecord(value: unknown): value is JsonRecord {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: JsonRecord, keys: readonly string[]): boolean {
    const valueKeys = Object.keys(value).sort();
    const expectedKeys = [...keys].sort();
    return valueKeys.length === expectedKeys.length && valueKeys.every((key, index) => key === expectedKeys[index]);
}

function isCanonicalSerializedAddNote(value: unknown): value is CanonicalSerializedAddNote {
    return (
        isRecord(value) &&
        hasExactKeys(value, CANONICAL_ADD_NOTE_KEYS) &&
        typeof value.id === 'string' &&
        value.id.trim().length > 0 &&
        typeof value.pitch === 'number' &&
        Number.isInteger(value.pitch) &&
        value.pitch >= 0 &&
        value.pitch <= 127 &&
        typeof value.startBeat === 'number' &&
        Number.isFinite(value.startBeat) &&
        value.startBeat >= 0 &&
        typeof value.duration === 'number' &&
        Number.isFinite(value.duration) &&
        value.duration >= 0.0625 &&
        typeof value.velocity === 'number' &&
        Number.isInteger(value.velocity) &&
        value.velocity >= 1 &&
        value.velocity <= 127 &&
        value.probability === 100
    );
}

export function isCanonicalSerializedAddNotesArguments(value: unknown): value is CanonicalSerializedAddNotesArguments {
    return (
        isRecord(value) &&
        hasExactKeys(value, CANONICAL_ADD_NOTES_ARGUMENT_KEYS) &&
        typeof value.clipId === 'string' &&
        value.clipId.trim().length > 0 &&
        Array.isArray(value.notes) &&
        value.notes.length > 0 &&
        value.notes.every(isCanonicalSerializedAddNote)
    );
}
