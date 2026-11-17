import { isRecord, valuesEqual } from '#/utils/structuralEquality';

import { type MidiNote } from '../models/MidiNote';
import { isMidiNoteSnapshot } from '../transformers/isMidiNoteSnapshot';

import { planMidiNoteEdits } from './planMidiNoteEdits';

type NoteBucket = { present: boolean; value: readonly unknown[] };

function isBeatWindow(value: unknown): value is { startBeat: number; endBeat: number } {
    return (
        isRecord(value) &&
        Reflect.ownKeys(value).length === 2 &&
        Object.hasOwn(value, 'startBeat') &&
        Object.hasOwn(value, 'endBeat') &&
        typeof value.startBeat === 'number' &&
        Number.isFinite(value.startBeat) &&
        value.startBeat >= 0 &&
        typeof value.endBeat === 'number' &&
        Number.isFinite(value.endBeat) &&
        value.endBeat > value.startBeat
    );
}

function containsNote(window: { startBeat: number; endBeat: number }, note: MidiNote | null): boolean {
    return note === null || (note.startBeat >= window.startBeat && note.startBeat + note.duration <= window.endBeat);
}

function isId(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0;
}

/** Verify the captured source and plan the same exact delta for preview, execution and replay. */
export function planGuardedMidiNoteEdits(value: unknown, actual?: NoteBucket) {
    if (
        !isRecord(value) ||
        Reflect.ownKeys(value).length !== 3 ||
        !Object.hasOwn(value, 'clipId') ||
        !Object.hasOwn(value, 'guard') ||
        !Object.hasOwn(value, 'operations') ||
        !isId(value.clipId) ||
        !isRecord(value.guard)
    ) {
        return null;
    }
    const { guard, operations } = value;
    if (
        Reflect.ownKeys(guard).length !== 5 ||
        !['trackId', 'expectedNotes', 'expectedNotesBucketPresent', 'editWindow', 'scope'].every((key) =>
            Object.hasOwn(guard, key)
        ) ||
        !isId(guard.trackId) ||
        !isBeatWindow(guard.editWindow) ||
        !isMidiNoteSnapshot(guard.expectedNotes) ||
        typeof guard.expectedNotesBucketPresent !== 'boolean' ||
        (!guard.expectedNotesBucketPresent && guard.expectedNotes.length > 0) ||
        (actual &&
            (actual.present !== guard.expectedNotesBucketPresent ||
                !isMidiNoteSnapshot(actual.value) ||
                !valuesEqual(actual.value, guard.expectedNotes)))
    ) {
        return null;
    }

    const plan = planMidiNoteEdits({ notes: guard.expectedNotes, operations, scope: guard.scope });
    const editWindow = guard.editWindow;
    if (
        plan.status === 'rejected' ||
        plan.changes.some(
            (change) => !containsNote(editWindow, change.before) || !containsNote(editWindow, change.after)
        )
    ) {
        return null;
    }
    return {
        ...plan,
        clipId: value.clipId,
        editWindow,
        trackId: guard.trackId,
        before: guard.expectedNotes,
        beforePresent: guard.expectedNotesBucketPresent,
        isNoop: valuesEqual(guard.expectedNotes, plan.notes),
    };
}
