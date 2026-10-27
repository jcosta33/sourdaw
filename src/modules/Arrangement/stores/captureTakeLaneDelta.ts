import { type MidiTakeSource, type Take, type TakeLane } from '../models/TakeLane';

import { captureBaseGapAudioSources } from './baseGapAudioSourceDelta';
import { cloneValue, optionalMidiSource, optionalNumber, optionalString, valuesEqual } from './takeLaneJournalValues';
import {
    type TakeFieldOperation,
    type TakeLaneStoreValue,
    type TakeLaneWriteJournal,
    type TakeLaneWriteOperation,
} from './takeLaneWriteJournalTypes';

function previousIdentity<Item extends { readonly id: string }>(items: readonly Item[], index: number): string | null {
    return index > 0 ? (items[index - 1]?.id ?? null) : null;
}

function changedMidiRows<Row extends { readonly id: string }>(
    before: { readonly present: boolean; readonly value: readonly Row[] },
    next: { readonly present: boolean; readonly value: readonly Row[] },
    operation: (
        expected: Row | null,
        replacement: Row | null,
        expectedSlotPresent: boolean,
        replacementSlotPresent: boolean
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
        (expected, replacement, expectedSlotPresent, replacementSlotPresent) => ({
            kind: 'take-midi-source-note-row',
            laneId,
            takeId,
            expected,
            replacement,
            expectedSlotPresent,
            replacementSlotPresent,
        })
    );
    const controllers = changedMidiRows(
        beforeRows.controlChanges,
        nextRows.controlChanges,
        (expected, replacement, expectedSlotPresent, replacementSlotPresent) => ({
            kind: 'take-midi-source-cc-row',
            laneId,
            takeId,
            expected,
            replacement,
            expectedSlotPresent,
            replacementSlotPresent,
        })
    );
    const bends = changedMidiRows(
        beforeRows.pitchBends,
        nextRows.pitchBends,
        (expected, replacement, expectedSlotPresent, replacementSlotPresent) => ({
            kind: 'take-midi-source-bend-row',
            laneId,
            takeId,
            expected,
            replacement,
            expectedSlotPresent,
            replacementSlotPresent,
        })
    );
    return notes && controllers && bends ? [...notes, ...controllers, ...bends] : null;
}

function captureMidiSourceChanges(laneId: string, before: Take, next: Take): TakeFieldOperation[] {
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

function captureTakeFieldOperations(laneId: string, before: Take, next: Take): TakeFieldOperation[] {
    const operations: TakeFieldOperation[] = [];
    for (const field of ['clipId', 'name'] as const) {
        if (before[field] !== next[field]) {
            operations.push({
                kind: 'take-string-field',
                laneId,
                takeId: before.id,
                field,
                expected: before[field],
                replacement: next[field],
            });
        }
    }
    for (const field of ['startBeat', 'endBeat'] as const) {
        if (before[field] !== next[field]) {
            operations.push({
                kind: 'take-number-field',
                laneId,
                takeId: before.id,
                field,
                expected: before[field],
                replacement: next[field],
            });
        }
    }
    if (before.selected !== next.selected) {
        operations.push({
            kind: 'take-selected-field',
            laneId,
            takeId: before.id,
            expected: before.selected,
            replacement: next.selected,
        });
    }
    for (const field of [
        'sourceOffsetBeats',
        'sourceOffsetSeconds',
        'passAnchorSeconds',
        'passDepthSeconds',
        'passSourceEndSeconds',
        'passOriginBeat',
        'passOriginSourceSeconds',
        'recordingPassIndex',
    ] as const) {
        const beforeValue = optionalNumber(before, field);
        const nextValue = optionalNumber(next, field);
        if (!valuesEqual(beforeValue, nextValue)) {
            operations.push({
                kind: 'take-optional-number-field',
                laneId,
                takeId: before.id,
                field,
                expected: beforeValue,
                replacement: nextValue,
            });
        }
    }
    operations.push(...captureMidiSourceChanges(laneId, before, next));
    return operations;
}

function captureLaneOperations(before: TakeLane, next: TakeLane): TakeLaneWriteOperation[] {
    const operations: TakeLaneWriteOperation[] = [];
    if (before.trackId !== next.trackId) {
        operations.push({
            kind: 'lane-track-field',
            laneId: before.id,
            expected: before.trackId,
            replacement: next.trackId,
        });
    }
    const beforeAutomation = optionalString(before, 'automationLaneId');
    const nextAutomation = optionalString(next, 'automationLaneId');
    if (!valuesEqual(beforeAutomation, nextAutomation)) {
        operations.push({
            kind: 'lane-automation-field',
            laneId: before.id,
            expected: beforeAutomation,
            replacement: nextAutomation,
        });
    }

    const beforeTakes = new Map(before.takes.map((take) => [take.id, take]));
    const nextTakes = new Map(next.takes.map((take) => [take.id, take]));
    for (const take of before.takes) {
        if (!nextTakes.has(take.id)) {
            operations.push({ kind: 'remove-take', laneId: before.id, takeId: take.id });
        }
    }
    for (const [index, take] of next.takes.entries()) {
        const previous = beforeTakes.get(take.id);
        if (!previous) {
            operations.push({
                kind: 'insert-take',
                laneId: before.id,
                take: cloneValue(take),
                afterTakeId: previousIdentity(next.takes, index),
            });
            continue;
        }
        operations.push(...captureTakeFieldOperations(before.id, previous, take));
    }

    if (!valuesEqual(before.activeCompRegions, next.activeCompRegions)) {
        operations.push({
            kind: 'replace-comp-regions',
            laneId: before.id,
            expected: cloneValue(before.activeCompRegions),
            replacement: cloneValue(next.activeCompRegions),
        });
    }
    const beforeGaps = captureBaseGapAudioSources(before);
    const nextGaps = captureBaseGapAudioSources(next);
    if (!valuesEqual(beforeGaps, nextGaps)) {
        operations.push({
            kind: 'replace-base-gap-audio-sources',
            laneId: before.id,
            expected: beforeGaps,
            replacement: nextGaps,
        });
    }
    return operations;
}

export function captureDelta(before: TakeLaneStoreValue | null, next: TakeLaneStoreValue | null): TakeLaneWriteJournal {
    if (before === null || next === null) {
        return [{ kind: 'replace-state', expected: cloneValue(before), replacement: cloneValue(next) }];
    }
    const operations: TakeLaneWriteOperation[] = [];
    const beforeLanes = new Map(before.lanes.map((lane) => [lane.id, lane]));
    const nextLanes = new Map(next.lanes.map((lane) => [lane.id, lane]));
    for (const lane of before.lanes) {
        if (!nextLanes.has(lane.id)) {
            operations.push({ kind: 'remove-lane', laneId: lane.id });
        }
    }
    for (const [index, lane] of next.lanes.entries()) {
        const previous = beforeLanes.get(lane.id);
        if (!previous) {
            operations.push({
                kind: 'insert-lane',
                lane: cloneValue(lane),
                afterLaneId: previousIdentity(next.lanes, index),
            });
            continue;
        }
        operations.push(...captureLaneOperations(previous, lane));
    }
    return operations;
}
