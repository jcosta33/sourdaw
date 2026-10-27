import { isFrozenMidiTakeSource } from '#/modules/MIDI/stores';

import { type Take, type TakeLane } from '../models/TakeLane';

import { cloneValue, optionalMidiSource, optionalNumber, valuesEqual } from './takeLaneJournalValues';
import { type TakeFieldOperation, type TakeLaneStoreValue } from './takeLaneWriteJournalTypes';

function findTake(lane: TakeLane, takeId: string): Take | undefined {
    return lane.takes.find((take) => take.id === takeId);
}

function replaceLane(state: TakeLaneStoreValue, replacement: TakeLane): TakeLaneStoreValue {
    return { lanes: state.lanes.map((lane) => (lane.id === replacement.id ? replacement : lane)) };
}

function replaceCapturedMidiRow<Row extends { readonly id: string }>(
    rows: readonly Row[],
    expected: Row | null,
    replacement: Row | null
): Row[] | null {
    if (expected === null && replacement === null) {
        return null;
    }
    if (expected === null) {
        if (!replacement || rows.some((row) => row.id === replacement.id)) {
            return null;
        }
        return [...rows, cloneValue(replacement)];
    }
    if (replacement !== null && expected.id !== replacement.id) {
        return null;
    }
    const index = rows.findIndex((row) => row.id === expected.id);
    if (index < 0 || !valuesEqual(rows[index], expected)) {
        return null;
    }
    if (replacement === null) {
        return rows.filter((_, rowIndex) => rowIndex !== index);
    }
    return rows.map((row, rowIndex) => (rowIndex === index ? cloneValue(replacement) : row));
}

type MidiRowOperation = Extract<
    TakeFieldOperation,
    { kind: 'take-midi-source-note-row' | 'take-midi-source-cc-row' | 'take-midi-source-bend-row' }
>;

function isValidReplacementSlot<Row>(value: Row[] | null, present: boolean): value is Row[] {
    return value !== null && (present || value.length === 0);
}

function applyMidiRow(take: Take, operation: MidiRowOperation): Take | undefined {
    if (operation.kind === 'take-midi-source-note-row') {
        const source = take.midiSource;
        if (!source || source.rows.notes.present !== operation.expectedSlotPresent) {
            return undefined;
        }
        const value = replaceCapturedMidiRow(source.rows.notes.value, operation.expected, operation.replacement);
        if (!isValidReplacementSlot(value, operation.replacementSlotPresent)) {
            return undefined;
        }
        const midiSource = {
            ...source,
            rows: { ...source.rows, notes: { present: operation.replacementSlotPresent, value } },
        };
        if (!isFrozenMidiTakeSource(midiSource)) {
            return undefined;
        }
        return { ...take, midiSource };
    } else if (operation.kind === 'take-midi-source-cc-row') {
        const source = take.midiSource;
        if (!source || source.rows.controlChanges.present !== operation.expectedSlotPresent) {
            return undefined;
        }
        const value = replaceCapturedMidiRow(
            source.rows.controlChanges.value,
            operation.expected,
            operation.replacement
        );
        if (!isValidReplacementSlot(value, operation.replacementSlotPresent)) {
            return undefined;
        }
        const midiSource = {
            ...source,
            rows: { ...source.rows, controlChanges: { present: operation.replacementSlotPresent, value } },
        };
        if (!isFrozenMidiTakeSource(midiSource)) {
            return undefined;
        }
        return { ...take, midiSource };
    } else if (operation.kind === 'take-midi-source-bend-row') {
        const source = take.midiSource;
        if (!source || source.rows.pitchBends.present !== operation.expectedSlotPresent) {
            return undefined;
        }
        const value = replaceCapturedMidiRow(source.rows.pitchBends.value, operation.expected, operation.replacement);
        if (!isValidReplacementSlot(value, operation.replacementSlotPresent)) {
            return undefined;
        }
        const midiSource = {
            ...source,
            rows: { ...source.rows, pitchBends: { present: operation.replacementSlotPresent, value } },
        };
        if (!isFrozenMidiTakeSource(midiSource)) {
            return undefined;
        }
        return { ...take, midiSource };
    }
    return undefined;
}

export function applyTakeFieldOperation(
    state: TakeLaneStoreValue,
    lane: TakeLane,
    operation: TakeFieldOperation
): TakeLaneStoreValue | undefined {
    const take = findTake(lane, operation.takeId);
    if (!take) {
        return undefined;
    }
    let replacementTake: Take;
    if (operation.kind === 'take-optional-number-field') {
        if (!valuesEqual(optionalNumber(take, operation.field), operation.expected)) {
            return undefined;
        }
        replacementTake = cloneValue(take);
        if (operation.replacement.present) {
            replacementTake[operation.field] = operation.replacement.value;
        } else {
            delete replacementTake[operation.field];
        }
    } else if (operation.kind === 'take-midi-source-phase') {
        if (!take.midiSource || !Object.is(take.midiSource.phaseHeadBeat, operation.expected)) {
            return undefined;
        }
        replacementTake = {
            ...take,
            midiSource: { ...take.midiSource, phaseHeadBeat: operation.replacement },
        };
    } else if (operation.kind === 'take-midi-source-field') {
        if (!valuesEqual(optionalMidiSource(take), operation.expected)) {
            return undefined;
        }
        replacementTake = cloneValue(take);
        if (operation.replacement.present) {
            replacementTake.midiSource = cloneValue(operation.replacement.value);
        } else {
            delete replacementTake.midiSource;
        }
    } else if (
        operation.kind === 'take-midi-source-note-row' ||
        operation.kind === 'take-midi-source-cc-row' ||
        operation.kind === 'take-midi-source-bend-row'
    ) {
        const updated = applyMidiRow(take, operation);
        if (!updated) {
            return undefined;
        }
        replacementTake = updated;
    } else if (operation.kind === 'take-selected-field') {
        if (take.selected !== operation.expected) {
            return undefined;
        }
        replacementTake = { ...take, selected: operation.replacement };
    } else {
        if (take[operation.field] !== operation.expected) {
            return undefined;
        }
        replacementTake = { ...take, [operation.field]: operation.replacement };
    }
    return replaceLane(state, {
        ...lane,
        takes: lane.takes.map((candidate) => (candidate.id === take.id ? replacementTake : candidate)),
    });
}
