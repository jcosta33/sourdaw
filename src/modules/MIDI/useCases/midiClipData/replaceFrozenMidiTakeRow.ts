import {
    type MidiClipCcSnapshot,
    type MidiClipNoteSnapshot,
    type MidiClipPitchBendSnapshot,
} from '#/utils/handlerContract';
import { valuesEqual } from '#/utils/structuralEquality';

import { isFrozenMidiTakeSource, type FrozenMidiTakeSource } from '../../stores/isFrozenMidiTakeSource';

type SlotPresence = { readonly expectedSlotPresent?: boolean; readonly replacementSlotPresent?: boolean };
type FrozenMidiTakeRowEdit = SlotPresence &
    (
        | {
              readonly kind: 'note';
              readonly expected: MidiClipNoteSnapshot | null;
              readonly replacement: MidiClipNoteSnapshot | null;
          }
        | {
              readonly kind: 'cc';
              readonly expected: MidiClipCcSnapshot | null;
              readonly replacement: MidiClipCcSnapshot | null;
          }
        | {
              readonly kind: 'bend';
              readonly expected: MidiClipPitchBendSnapshot | null;
              readonly replacement: MidiClipPitchBendSnapshot | null;
          }
    );

function replaceRow<Row extends { readonly id: string }>(
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
        return [...rows, structuredClone(replacement)];
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
    return rows.map((row, rowIndex) => (rowIndex === index ? structuredClone(replacement) : row));
}

/**
 * One row is the write owner. A peer's edit to another row never enters the
 * expected value and is retained by the result; the inverse uses the same
 * operation with expected and replacement swapped.
 */
export function replaceFrozenMidiTakeRow(
    source: FrozenMidiTakeSource,
    edit: FrozenMidiTakeRowEdit
): FrozenMidiTakeSource | null {
    if (!isFrozenMidiTakeSource(source)) {
        return null;
    }
    const expectedPresent = edit.expectedSlotPresent ?? true;
    const replacementPresent = edit.replacementSlotPresent ?? true;
    let next: FrozenMidiTakeSource;
    switch (edit.kind) {
        case 'note': {
            if (source.rows.notes.present !== expectedPresent) {
                return null;
            }
            const value = replaceRow(source.rows.notes.value, edit.expected, edit.replacement);
            if (!value || (!replacementPresent && value.length > 0)) {
                return null;
            }
            next = { ...source, rows: { ...source.rows, notes: { present: replacementPresent, value } } };
            break;
        }
        case 'cc': {
            if (source.rows.controlChanges.present !== expectedPresent) {
                return null;
            }
            const value = replaceRow(source.rows.controlChanges.value, edit.expected, edit.replacement);
            if (!value || (!replacementPresent && value.length > 0)) {
                return null;
            }
            next = { ...source, rows: { ...source.rows, controlChanges: { present: replacementPresent, value } } };
            break;
        }
        case 'bend': {
            if (source.rows.pitchBends.present !== expectedPresent) {
                return null;
            }
            const value = replaceRow(source.rows.pitchBends.value, edit.expected, edit.replacement);
            if (!value || (!replacementPresent && value.length > 0)) {
                return null;
            }
            next = { ...source, rows: { ...source.rows, pitchBends: { present: replacementPresent, value } } };
            break;
        }
    }
    return isFrozenMidiTakeSource(next) ? next : null;
}
