import { MAX_MIDI_DATA_7BIT, MIN_AUDIBLE_VELOCITY } from '#/utils/midiData';
import { MIDI_NOTE_EDIT_MAX_OPERATIONS, MIDI_NOTE_MIN_DURATION_BEATS } from '#/utils/midiNoteBatchLimits';
import { isRecord } from '#/utils/structuralEquality';

import { type RuntimeAction } from '../models/RuntimeAction';

function hasKeys(record: Record<string, unknown>, keys: readonly string[]): boolean {
    return Reflect.ownKeys(record).length === keys.length && keys.every((key) => Object.hasOwn(record, key));
}

function isId(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0 && value.length <= 512 && !value.startsWith('$');
}

function validFields(record: Record<string, unknown>): boolean {
    const keys = Reflect.ownKeys(record);
    return (
        keys.length > 0 &&
        keys.every((key) => {
            if (typeof key !== 'string') {
                return false;
            }
            const value = record[key];
            if (typeof value !== 'number' || !Number.isFinite(value)) {
                return false;
            }
            switch (key) {
                case 'pitch':
                    return Number.isInteger(value) && value >= 0 && value <= MAX_MIDI_DATA_7BIT;
                case 'velocity':
                    return Number.isInteger(value) && value >= MIN_AUDIBLE_VELOCITY && value <= MAX_MIDI_DATA_7BIT;
                case 'startBeat':
                    return value >= 0;
                case 'duration':
                    return value >= MIDI_NOTE_MIN_DURATION_BEATS;
                default:
                    return false;
            }
        })
    );
}

function isOperation(value: unknown): boolean {
    if (!isRecord(value)) {
        return false;
    }
    switch (value.type) {
        case 'patch':
            return (
                hasKeys(value, ['type', 'noteId', 'patch']) &&
                isId(value.noteId) &&
                isRecord(value.patch) &&
                validFields(value.patch)
            );
        case 'delete':
            return hasKeys(value, ['type', 'noteId']) && isId(value.noteId);
        case 'insert': {
            const note = value.note;
            return (
                hasKeys(value, ['type', 'note']) &&
                isRecord(note) &&
                ['pitch', 'startBeat', 'duration'].every((key) => Object.hasOwn(note, key)) &&
                validFields(note)
            );
        }
        default:
            return false;
    }
}

export function isMidiNoteEditProposal(
    value: unknown
): value is Extract<RuntimeAction, { type: 'editMidiNotes' }>['payload'] {
    return (
        isRecord(value) &&
        hasKeys(value, ['clipId', 'operations']) &&
        isId(value.clipId) &&
        Array.isArray(value.operations) &&
        value.operations.length > 0 &&
        value.operations.length <= MIDI_NOTE_EDIT_MAX_OPERATIONS &&
        [...value.operations].every(isOperation)
    );
}
