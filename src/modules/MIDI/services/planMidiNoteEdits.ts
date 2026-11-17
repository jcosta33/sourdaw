import { MAX_MIDI_DATA_7BIT, MIN_AUDIBLE_VELOCITY } from '#/utils/midiData';
import { MIDI_NOTE_EDIT_MAX_OPERATIONS, MIDI_NOTE_MIN_DURATION_BEATS } from '#/utils/midiNoteBatchLimits';

import { type MidiNote } from '../models/MidiNote';
import {
    type MaterializedMidiNoteEditOperation,
    type MaterializedMidiNoteInsertion,
    type MidiNoteEditPatch,
    type MidiNoteEditScope,
    type MidiNoteEditWindow,
} from '../models/MidiNoteEdit';
import { isMidiNoteSnapshot } from '../transformers/isMidiNoteSnapshot';
import { normalizeMidiNoteInput } from '../transformers/normalizeMidiNoteInput';

import { sliceMidiNoteExtent } from './sliceMidiNoteExtent';

type NoteEditChange = {
    type: MaterializedMidiNoteEditOperation['type'];
    noteId: string;
    before: MidiNote | null;
    after: MidiNote | null;
};

type RefusalReason =
    | 'invalid-source'
    | 'invalid-scope'
    | 'invalid-operations'
    | 'operation-budget-exceeded'
    | 'note-not-found'
    | 'note-not-allowed'
    | 'protected-note'
    | 'protected-window'
    | 'insert-id-collision'
    | 'insertion-budget-exceeded'
    | 'outside-insertion-window';

type PlanResult =
    | { status: 'planned'; notes: MidiNote[]; changes: NoteEditChange[] }
    | { status: 'rejected'; reason: RefusalReason; operationIndex?: number };

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasKeys(value: object, required: readonly string[], optional: readonly string[] = []): boolean {
    return (
        required.every((key) => Object.hasOwn(value, key)) &&
        Reflect.ownKeys(value).every((key) => typeof key === 'string' && [...required, ...optional].includes(key))
    );
}

function isId(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0;
}

function isFiniteBeat(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isIntegerInRange(value: unknown, minimum: number): value is number {
    return typeof value === 'number' && Number.isInteger(value) && value >= minimum && value <= MAX_MIDI_DATA_7BIT;
}

function isNoteField(key: string, value: unknown): boolean {
    switch (key) {
        case 'pitch':
            return isIntegerInRange(value, 0);
        case 'velocity':
            return isIntegerInRange(value, MIN_AUDIBLE_VELOCITY);
        case 'startBeat':
            return isFiniteBeat(value);
        case 'duration':
            return isFiniteBeat(value) && value >= MIDI_NOTE_MIN_DURATION_BEATS;
        default:
            return false;
    }
}

function isPatch(value: unknown): value is MidiNoteEditPatch {
    return (
        isRecord(value) &&
        Reflect.ownKeys(value).length > 0 &&
        Reflect.ownKeys(value).every((key) => typeof key === 'string' && isNoteField(key, value[key]))
    );
}

function isInsertNote(value: unknown): value is MaterializedMidiNoteInsertion {
    return (
        isRecord(value) &&
        hasKeys(value, ['id', 'pitch', 'startBeat', 'duration'], ['velocity', 'probability']) &&
        isId(value.id) &&
        ['pitch', 'startBeat', 'duration'].every((key) => isNoteField(key, value[key])) &&
        (!Object.hasOwn(value, 'velocity') || isNoteField('velocity', value.velocity)) &&
        (!Object.hasOwn(value, 'probability') || value.probability === 100) &&
        isFiniteSpan(value.startBeat, value.duration)
    );
}

function isOperation(value: unknown): value is MaterializedMidiNoteEditOperation {
    if (!isRecord(value)) {
        return false;
    }
    switch (value.type) {
        case 'patch':
            return hasKeys(value, ['type', 'noteId', 'patch']) && isId(value.noteId) && isPatch(value.patch);
        case 'delete':
            return hasKeys(value, ['type', 'noteId']) && isId(value.noteId);
        case 'insert':
            return hasKeys(value, ['type', 'note']) && isInsertNote(value.note);
        default:
            return false;
    }
}

function isIdList(value: unknown): value is readonly string[] {
    if (!Array.isArray(value)) {
        return false;
    }
    const items: readonly unknown[] = value;
    return [...items].every(isId) && new Set(items).size === items.length;
}

function isWindowList(value: unknown): value is readonly MidiNoteEditWindow[] {
    if (!Array.isArray(value)) {
        return false;
    }
    const items: readonly unknown[] = value;
    return [...items].every(
        (window) =>
            isRecord(window) &&
            hasKeys(window, ['startBeat', 'endBeat']) &&
            isFiniteBeat(window.startBeat) &&
            isFiniteBeat(window.endBeat) &&
            window.endBeat > window.startBeat
    );
}

function isScope(value: unknown): value is MidiNoteEditScope {
    return (
        isRecord(value) &&
        hasKeys(value, [
            'allowedNoteIds',
            'protectedNoteIds',
            'protectedWindows',
            'insertionWindows',
            'insertionBudget',
        ]) &&
        isIdList(value.allowedNoteIds) &&
        isIdList(value.protectedNoteIds) &&
        isWindowList(value.protectedWindows) &&
        isWindowList(value.insertionWindows) &&
        typeof value.insertionBudget === 'number' &&
        Number.isSafeInteger(value.insertionBudget) &&
        value.insertionBudget >= 0 &&
        value.insertionBudget <= MIDI_NOTE_EDIT_MAX_OPERATIONS
    );
}

function isFiniteSpan(startBeat: unknown, duration: unknown): boolean {
    return (
        isFiniteBeat(startBeat) &&
        typeof duration === 'number' &&
        Number.isFinite(duration) &&
        duration > 0 &&
        Number.isFinite(startBeat + duration) &&
        startBeat + duration > startBeat
    );
}

function overlapsWindow(note: MidiNote, window: MidiNoteEditWindow): boolean {
    return note.startBeat < window.endBeat && note.startBeat + note.duration > window.startBeat;
}

function copyNote(note: MidiNote): MidiNote {
    return structuredClone(note);
}

function patchNote(note: MidiNote, patch: MidiNoteEditPatch): MidiNote {
    let base = note;
    if (patch.duration !== undefined && patch.duration < note.duration) {
        base = sliceMidiNoteExtent(note, { fromOffset: 0, duration: patch.duration });
    }
    return copyNote({ ...base, ...patch });
}

function planInsertion(
    scope: MidiNoteEditScope,
    note: MaterializedMidiNoteInsertion,
    usedIds: ReadonlySet<string>,
    protectedIds: ReadonlySet<string>,
    insertedCount: number
): MidiNote | RefusalReason {
    if (usedIds.has(note.id)) {
        return 'insert-id-collision';
    }
    if (protectedIds.has(note.id)) {
        return 'protected-note';
    }
    if (insertedCount >= scope.insertionBudget) {
        return 'insertion-budget-exceeded';
    }
    const after = normalizeMidiNoteInput(note);
    if (scope.protectedWindows.some((window) => overlapsWindow(after, window))) {
        return 'protected-window';
    }
    if (
        !scope.insertionWindows.some(
            (window) => after.startBeat >= window.startBeat && after.startBeat + after.duration <= window.endBeat
        )
    ) {
        return 'outside-insertion-window';
    }
    return after;
}

/** Plan one clip's ordered edits without writing project state or assigning new identities. */
export function planMidiNoteEdits(input: { notes: unknown; operations: unknown; scope: unknown }): PlanResult {
    if (
        !isMidiNoteSnapshot(input.notes) ||
        input.notes.some(
            (note) =>
                !isIntegerInRange(note.pitch, 0) ||
                !isIntegerInRange(note.velocity, MIN_AUDIBLE_VELOCITY) ||
                !isFiniteSpan(note.startBeat, note.duration)
        )
    ) {
        return { status: 'rejected', reason: 'invalid-source' };
    }
    if (!isScope(input.scope)) {
        return { status: 'rejected', reason: 'invalid-scope' };
    }
    if (!Array.isArray(input.operations) || input.operations.length === 0) {
        return { status: 'rejected', reason: 'invalid-operations' };
    }
    if (input.operations.length > MIDI_NOTE_EDIT_MAX_OPERATIONS) {
        return { status: 'rejected', reason: 'operation-budget-exceeded' };
    }

    const notes = input.notes.map(copyNote);
    const changes: NoteEditChange[] = [];
    const usedIds = new Set(notes.map((note) => note.id));
    const allowedIds = new Set(input.scope.allowedNoteIds);
    const protectedIds = new Set(input.scope.protectedNoteIds);
    let insertedCount = 0;
    for (const [operationIndex, operation] of input.operations.entries()) {
        function refuse(reason: RefusalReason): PlanResult {
            return { status: 'rejected', reason, operationIndex };
        }
        if (!isOperation(operation)) {
            return refuse('invalid-operations');
        }
        if (operation.type === 'insert') {
            const after = planInsertion(input.scope, operation.note, usedIds, protectedIds, insertedCount);
            if (typeof after === 'string') {
                return refuse(after);
            }
            insertedCount += 1;
            usedIds.add(after.id);
            notes.push(after);
            changes.push({ type: 'insert', noteId: after.id, before: null, after: copyNote(after) });
            continue;
        }

        const index = notes.findIndex((note) => note.id === operation.noteId);
        const before = notes[index];
        if (!before) {
            return refuse('note-not-found');
        }
        if (protectedIds.has(before.id)) {
            return refuse('protected-note');
        }
        if (!allowedIds.has(before.id)) {
            return refuse('note-not-allowed');
        }
        const after = operation.type === 'patch' ? patchNote(before, operation.patch) : null;
        if (after && !isFiniteSpan(after.startBeat, after.duration)) {
            return refuse('invalid-operations');
        }
        if (
            input.scope.protectedWindows.some(
                (window) => overlapsWindow(before, window) || (after !== null && overlapsWindow(after, window))
            )
        ) {
            return refuse('protected-window');
        }
        changes.push({
            type: operation.type,
            noteId: before.id,
            before: copyNote(before),
            after: after === null ? null : copyNote(after),
        });
        if (after) {
            notes[index] = after;
        } else {
            notes.splice(index, 1);
        }
    }
    return { status: 'planned', notes, changes };
}
