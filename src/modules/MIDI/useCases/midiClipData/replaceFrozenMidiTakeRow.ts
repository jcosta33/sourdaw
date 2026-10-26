import {
    type MidiClipCcSnapshot,
    type MidiClipNoteSnapshot,
    type MidiClipPitchBendSnapshot,
} from '#/utils/handlerContract';
import { valuesEqual } from '#/utils/structuralEquality';

import { isFrozenMidiTakeSource, type FrozenMidiTakeSource } from './projectFrozenMidiTakeWindow';

type FrozenMidiTakeRowEdit =
    | { readonly kind: 'note'; readonly expected: MidiClipNoteSnapshot; readonly replacement: MidiClipNoteSnapshot }
    | { readonly kind: 'cc'; readonly expected: MidiClipCcSnapshot; readonly replacement: MidiClipCcSnapshot }
    | {
          readonly kind: 'bend';
          readonly expected: MidiClipPitchBendSnapshot;
          readonly replacement: MidiClipPitchBendSnapshot;
      };

function replaceRow<Row extends { readonly id: string }>(
    rows: readonly Row[],
    expected: Row,
    replacement: Row
): Row[] | null {
    if (expected.id !== replacement.id) {
        return null;
    }
    const index = rows.findIndex((row) => row.id === expected.id);
    if (index < 0 || !valuesEqual(rows[index], expected)) {
        return null;
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
    let next: FrozenMidiTakeSource;
    switch (edit.kind) {
        case 'note': {
            if (!source.rows.notes.present) {
                return null;
            }
            const value = replaceRow(source.rows.notes.value, edit.expected, edit.replacement);
            if (!value) {
                return null;
            }
            next = { ...source, rows: { ...source.rows, notes: { present: true, value } } };
            break;
        }
        case 'cc': {
            if (!source.rows.controlChanges.present) {
                return null;
            }
            const value = replaceRow(source.rows.controlChanges.value, edit.expected, edit.replacement);
            if (!value) {
                return null;
            }
            next = { ...source, rows: { ...source.rows, controlChanges: { present: true, value } } };
            break;
        }
        case 'bend': {
            if (!source.rows.pitchBends.present) {
                return null;
            }
            const value = replaceRow(source.rows.pitchBends.value, edit.expected, edit.replacement);
            if (!value) {
                return null;
            }
            next = { ...source, rows: { ...source.rows, pitchBends: { present: true, value } } };
            break;
        }
    }
    return isFrozenMidiTakeSource(next) ? next : null;
}
