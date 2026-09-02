type JsonRecord = Record<string, unknown>;

type MaterializedAddNote = {
    duration: number;
    id: string;
    pitch: number;
    probability?: number;
    startBeat: number;
    velocity: number;
};

type MaterializedAddNotesArguments = {
    clipId: string;
    notes: MaterializedAddNote[];
};

type MaterializedAddNotesValidationMode = 'command' | 'snapshot';

const MATERIALIZED_ADD_NOTES_ARGUMENT_KEYS = ['clipId', 'notes'] as const;
const MATERIALIZED_ADD_NOTE_KEYS = ['duration', 'id', 'pitch', 'probability', 'startBeat', 'velocity'] as const;
const MATERIALIZED_ADD_NOTE_KEYS_WITHOUT_PROBABILITY = ['duration', 'id', 'pitch', 'startBeat', 'velocity'] as const;

function isRecord(value: unknown): value is JsonRecord {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: JsonRecord, keys: readonly string[]): boolean {
    const valueKeys = Object.keys(value).sort();
    const expectedKeys = [...keys].sort();
    return valueKeys.length === expectedKeys.length && valueKeys.every((key, index) => key === expectedKeys[index]);
}

function isMaterializedAddNote(value: unknown, mode: MaterializedAddNotesValidationMode): value is MaterializedAddNote {
    if (!isRecord(value)) {
        return false;
    }
    const hasCanonicalKeys = hasExactKeys(value, MATERIALIZED_ADD_NOTE_KEYS);
    const hasSnapshotKeys = mode === 'snapshot' && hasExactKeys(value, MATERIALIZED_ADD_NOTE_KEYS_WITHOUT_PROBABILITY);
    return (
        (hasCanonicalKeys || hasSnapshotKeys) &&
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
        (hasSnapshotKeys || value.probability === 100)
    );
}

export function isMaterializedAddNotesArguments(
    value: unknown,
    mode: MaterializedAddNotesValidationMode = 'command'
): value is MaterializedAddNotesArguments {
    return (
        isRecord(value) &&
        hasExactKeys(value, MATERIALIZED_ADD_NOTES_ARGUMENT_KEYS) &&
        typeof value.clipId === 'string' &&
        value.clipId.trim().length > 0 &&
        Array.isArray(value.notes) &&
        (mode === 'snapshot' || value.notes.length > 0) &&
        value.notes.every((note) => isMaterializedAddNote(note, mode)) &&
        new Set(value.notes.map((note) => note.id)).size === value.notes.length
    );
}
