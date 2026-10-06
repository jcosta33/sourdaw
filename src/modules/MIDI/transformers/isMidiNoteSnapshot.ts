import {
    isValidMidiArticulation,
    isValidMidiNoteExpression,
    MIDI_NOTE_OPTIONAL_KEYS,
    MIDI_NOTE_REQUIRED_KEYS,
    type MidiNote,
} from '../models/MidiNote';

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactMidiNoteKeys(value: JsonRecord): boolean {
    const allowedKeys = new Set<string>([...MIDI_NOTE_REQUIRED_KEYS, ...MIDI_NOTE_OPTIONAL_KEYS]);
    return (
        MIDI_NOTE_REQUIRED_KEYS.every((key) => Object.hasOwn(value, key)) &&
        Object.keys(value).every((key) => allowedKeys.has(key))
    );
}

function isFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

function isOptionalFiniteNumber(value: JsonRecord, key: (typeof MIDI_NOTE_OPTIONAL_KEYS)[number]): boolean {
    return !Object.hasOwn(value, key) || value[key] === undefined || isFiniteNumber(value[key]);
}

function isMidiNote(value: unknown): value is MidiNote {
    return (
        isRecord(value) &&
        hasExactMidiNoteKeys(value) &&
        typeof value.id === 'string' &&
        value.id.trim().length > 0 &&
        isFiniteNumber(value.pitch) &&
        isFiniteNumber(value.startBeat) &&
        isFiniteNumber(value.duration) &&
        isFiniteNumber(value.velocity) &&
        isOptionalFiniteNumber(value, 'probability') &&
        isOptionalFiniteNumber(value, 'pressure') &&
        isOptionalFiniteNumber(value, 'slide') &&
        isOptionalFiniteNumber(value, 'pitchBend') &&
        isOptionalFiniteNumber(value, 'pitchBendRangeSemitones') &&
        isOptionalFiniteNumber(value, 'channel') &&
        (!Object.hasOwn(value, 'articulation') ||
            value.articulation === undefined ||
            isValidMidiArticulation(value.articulation)) &&
        (!Object.hasOwn(value, 'expression') ||
            value.expression === undefined ||
            isValidMidiNoteExpression(value.expression, value.duration))
    );
}

// #4876 — a note snapshot is a dense array. Array.prototype.every skips missing
// slots and Array.prototype.map preserves them, so a sparse hole used to pass
// both the note check and the id-count check, then normalized away into an
// empty write. Every position must hold a value; a hole is never a JSON value.
function isDense(value: readonly unknown[]): boolean {
    for (let index = 0; index < value.length; index += 1) {
        if (!Object.hasOwn(value, index)) {
            return false;
        }
    }
    return true;
}

export function isMidiNoteSnapshot(value: unknown): value is MidiNote[] {
    return (
        Array.isArray(value) &&
        isDense(value) &&
        value.every(isMidiNote) &&
        new Set(value.map((note) => note.id)).size === value.length
    );
}
