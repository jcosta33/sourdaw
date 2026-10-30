import { type MidiTakeSource, type Take } from '../models/TakeLane';

import { cloneValue, optionalMidiSource, valuesEqual } from './takeLaneJournalValues';
import { type TakeFieldOperation } from './takeLaneWriteTypes';

function changedMidiRows<Row extends { readonly id: string }>(
    before: { readonly present: boolean; readonly value: readonly Row[] },
    next: { readonly present: boolean; readonly value: readonly Row[] },
    operation: (
        expected: Row | null,
        replacement: Row | null,
        expectedSlotPresent: boolean,
        replacementSlotPresent: boolean,
        replacementNextRowId?: string | null
    ) => TakeFieldOperation
): TakeFieldOperation[] | null {
    if (valuesEqual(before, next)) {
        return [];
    }
    const previous = before.value;
    const following = next.value;
    if (previous.length === following.length && previous.every((row, index) => row.id === following[index]?.id)) {
        const changed = previous.flatMap((row, index) =>
            valuesEqual(row, following[index]) ? [] : [{ expected: row, replacement: following[index]! }]
        );
        if (changed.length !== 1) {
            return null;
        }
        return [
            operation(
                cloneValue(changed[0]!.expected),
                cloneValue(changed[0]!.replacement),
                before.present,
                next.present
            ),
        ];
    }
    if (following.length === previous.length + 1 && valuesEqual(previous, following.slice(0, -1))) {
        return [operation(null, cloneValue(following[following.length - 1]!), before.present, next.present)];
    }
    if (following.length === previous.length + 1) {
        for (const [index, row] of following.entries()) {
            if (
                !previous.some((candidate) => candidate.id === row.id) &&
                valuesEqual(
                    previous,
                    following.filter((candidate) => candidate.id !== row.id)
                )
            ) {
                return [
                    operation(null, cloneValue(row), before.present, next.present, following[index + 1]?.id ?? null),
                ];
            }
        }
    }
    if (previous.length === following.length + 1) {
        for (const row of previous) {
            if (
                valuesEqual(
                    previous.filter((candidate) => candidate.id !== row.id),
                    following
                )
            ) {
                return [operation(cloneValue(row), null, before.present, next.present)];
            }
        }
    }
    return null;
}

function captureMidiSourceRowOperations(
    laneId: string,
    takeId: string,
    before: MidiTakeSource,
    next: MidiTakeSource
): TakeFieldOperation[] | null {
    if (!valuesEqual({ ...before, rows: null }, { ...next, rows: null })) {
        return null;
    }
    const beforeRows = before.rows;
    const nextRows = next.rows;
    const notes = changedMidiRows(
        beforeRows.notes,
        nextRows.notes,
        (expected, replacement, expectedSlotPresent, replacementSlotPresent, replacementNextRowId) => ({
            kind: 'take-midi-source-note-row',
            laneId,
            takeId,
            expected,
            replacement,
            expectedSlotPresent,
            replacementSlotPresent,
            ...(replacementNextRowId !== undefined ? { replacementNextRowId } : {}),
        })
    );
    const controllers = changedMidiRows(
        beforeRows.controlChanges,
        nextRows.controlChanges,
        (expected, replacement, expectedSlotPresent, replacementSlotPresent, replacementNextRowId) => ({
            kind: 'take-midi-source-cc-row',
            laneId,
            takeId,
            expected,
            replacement,
            expectedSlotPresent,
            replacementSlotPresent,
            ...(replacementNextRowId !== undefined ? { replacementNextRowId } : {}),
        })
    );
    const bends = changedMidiRows(
        beforeRows.pitchBends,
        nextRows.pitchBends,
        (expected, replacement, expectedSlotPresent, replacementSlotPresent, replacementNextRowId) => ({
            kind: 'take-midi-source-bend-row',
            laneId,
            takeId,
            expected,
            replacement,
            expectedSlotPresent,
            replacementSlotPresent,
            ...(replacementNextRowId !== undefined ? { replacementNextRowId } : {}),
        })
    );
    if (!notes || !controllers || !bends) {
        return null;
    }
    const operations = [...notes, ...controllers, ...bends];
    return operations.length === 1 ? operations : null;
}

export function captureMidiSourceChanges(laneId: string, before: Take, next: Take): TakeFieldOperation[] {
    const operations: TakeFieldOperation[] = [];
    const beforeMidiSource = optionalMidiSource(before);
    const nextMidiSource = optionalMidiSource(next);
    if (!valuesEqual(beforeMidiSource, nextMidiSource)) {
        if (
            beforeMidiSource.present &&
            nextMidiSource.present &&
            valuesEqual({ ...beforeMidiSource.value, phaseHeadBeat: 0 }, { ...nextMidiSource.value, phaseHeadBeat: 0 })
        ) {
            operations.push({
                kind: 'take-midi-source-phase',
                laneId,
                takeId: before.id,
                expected: beforeMidiSource.value.phaseHeadBeat,
                replacement: nextMidiSource.value.phaseHeadBeat,
            });
        } else if (beforeMidiSource.present && nextMidiSource.present) {
            const rowOperations = captureMidiSourceRowOperations(
                laneId,
                before.id,
                beforeMidiSource.value,
                nextMidiSource.value
            );
            if (rowOperations) {
                operations.push(...rowOperations);
            } else {
                operations.push({
                    kind: 'take-midi-source-field',
                    laneId,
                    takeId: before.id,
                    expected: beforeMidiSource,
                    replacement: nextMidiSource,
                });
            }
        } else {
            operations.push({
                kind: 'take-midi-source-field',
                laneId,
                takeId: before.id,
                expected: beforeMidiSource,
                replacement: nextMidiSource,
            });
        }
    }
    return operations;
}
