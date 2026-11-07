import { PITCH_BEND_MAX, PITCH_BEND_MIN } from '#/utils/midiData';

import {
    MIDI_PITCH_BEND_OPTIONAL_KEYS,
    MIDI_PITCH_BEND_REQUIRED_KEYS,
    type MidiCC,
    type MidiPitchBend,
} from '../models/MidiNote';
import { isMidiNoteSnapshot } from '../transformers/isMidiNoteSnapshot';

function isRecord(value: unknown): value is Record<string, unknown> {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        return false;
    }
    const prototype = Reflect.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

// String keys only: rows read back from the project document carry the CRDT's
// own symbol-keyed object metadata, which is not content.
function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
    return keys.every((key) => Object.hasOwn(value, key)) && Object.keys(value).every((key) => keys.includes(key));
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

/** A pitch-bend row's own keys; `channelScoped` is the one it may leave out. */
function hasPitchBendKeys(value: Record<string, unknown>): boolean {
    if (Object.hasOwn(value, 'channelScoped')) {
        return hasExactKeys(value, [...MIDI_PITCH_BEND_REQUIRED_KEYS, ...MIDI_PITCH_BEND_OPTIONAL_KEYS]);
    }
    return hasExactKeys(value, MIDI_PITCH_BEND_REQUIRED_KEYS);
}

function isPitchBend(value: unknown): value is MidiPitchBend {
    return (
        isRecord(value) &&
        hasPitchBendKeys(value) &&
        (!Object.hasOwn(value, 'channelScoped') || typeof value.channelScoped === 'boolean') &&
        typeof value.id === 'string' &&
        isFiniteNumber(value.value) &&
        Number.isInteger(value.value) &&
        value.value >= PITCH_BEND_MIN &&
        value.value <= PITCH_BEND_MAX &&
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
