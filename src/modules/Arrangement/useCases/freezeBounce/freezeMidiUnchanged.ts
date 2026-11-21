import { midiStore } from '#/modules/MIDI/stores';
import { valuesEqual } from '#/utils/structuralEquality';

import { type FreezeMidiSnapshot } from './freezeMidiSnapshot';

function sortedById<Row extends { id: string }>(rows: Row[]): Row[] {
    return rows.toSorted((left, right) => left.id.localeCompare(right.id));
}

function rowsUnchanged<Row extends { id: string }>(
    captured: Record<string, Row[]>,
    live: Record<string, Row[]> | undefined
): boolean {
    return Object.entries(captured).every(([clipId, rows]) =>
        valuesEqual(sortedById(rows), sortedById(live?.[clipId] ?? []))
    );
}

/**
 * Compares by value, not identity: a write clones lists it did not change. Order is not content,
 * so the lists are compared by row id.
 */
export function freezeMidiUnchanged(snapshot: FreezeMidiSnapshot): boolean {
    const live = midiStore.value;
    return (
        rowsUnchanged(snapshot.notes, live?.notesByClipId) &&
        rowsUnchanged(snapshot.cc, live?.ccByClipId) &&
        rowsUnchanged(snapshot.pitchBend, live?.pitchBendByClipId)
    );
}
