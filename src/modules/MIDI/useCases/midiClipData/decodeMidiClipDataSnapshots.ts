import { type MidiCC, type MidiPitchBend } from '../../models/MidiNote';
import { isMidiNoteSnapshot } from '../../transformers/isMidiNoteSnapshot';

function isRecord(value: unknown): value is Record<string, unknown> {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        return false;
    }
    const prototype = Reflect.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
    return (
        keys.every((key) => Object.hasOwn(value, key)) &&
        Reflect.ownKeys(value).every((key) => typeof key === 'string' && keys.includes(key))
    );
}

function isFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

function isControlChange(value: unknown): value is MidiCC {
    return (
        isRecord(value) &&
        hasExactKeys(value, ['id', 'controller', 'value', 'beat', 'channel']) &&
        typeof value.id === 'string' &&
        isFiniteNumber(value.controller) &&
        isFiniteNumber(value.value) &&
        isFiniteNumber(value.beat) &&
        isFiniteNumber(value.channel)
    );
}

function isPitchBend(value: unknown): value is MidiPitchBend {
    return (
        isRecord(value) &&
        hasExactKeys(value, ['id', 'value', 'beat', 'channel']) &&
        typeof value.id === 'string' &&
        isFiniteNumber(value.value) &&
        isFiniteNumber(value.beat) &&
        isFiniteNumber(value.channel)
    );
}

function isSnapshot<Row extends { id: string }>(
    value: unknown,
    isRow: (candidate: unknown) => candidate is Row
): value is Row[] {
    if (!Array.isArray(value)) {
        return false;
    }
    const ids = new Set<string>();
    for (let index = 0; index < value.length; index += 1) {
        const row: unknown = value[index];
        if (!Object.hasOwn(value, index) || !isRow(row) || ids.has(row.id)) {
            return false;
        }
        ids.add(row.id);
    }
    return true;
}

/** Null leaves that owner untouched; an empty array restores a present empty slot. */
export function decodeMidiClipDataSnapshots(value: unknown) {
    if (!isRecord(value) || !hasExactKeys(value, ['notesSnapshot', 'controlChangeSnapshot', 'pitchBendSnapshot'])) {
        return null;
    }
    const { notesSnapshot, controlChangeSnapshot, pitchBendSnapshot } = value;
    if (
        (notesSnapshot !== null && !isMidiNoteSnapshot(notesSnapshot)) ||
        (controlChangeSnapshot !== null && !isSnapshot(controlChangeSnapshot, isControlChange)) ||
        (pitchBendSnapshot !== null && !isSnapshot(pitchBendSnapshot, isPitchBend))
    ) {
        return null;
    }
    return { notesSnapshot, controlChangeSnapshot, pitchBendSnapshot };
}
