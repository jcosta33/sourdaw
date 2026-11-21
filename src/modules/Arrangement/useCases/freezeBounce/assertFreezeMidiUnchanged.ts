import { midiStore } from '#/modules/MIDI/stores';
import { valuesEqual } from '#/utils/structuralEquality';

import { CHANGED_DURING_FREEZE } from './freezeChangedMessage';
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
 * Throws the same message a changed source does when the notes, CC or pitch-bend rows the render
 * read differ from the live ones. MIDI rows are not part of the track digest and are written from
 * routes the action guards do not cover, so this runs synchronously at the commit, where every
 * route has to pass. Compares by value, not identity (a write clones lists it did not change),
 * and by row id, since order is not content.
 */
export function assertFreezeMidiUnchanged(snapshot: FreezeMidiSnapshot): void {
    const live = midiStore.value;
    const unchanged =
        rowsUnchanged(snapshot.notes, live?.notesByClipId) &&
        rowsUnchanged(snapshot.cc, live?.ccByClipId) &&
        rowsUnchanged(snapshot.pitchBend, live?.pitchBendByClipId);
    if (!unchanged) {
        throw new Error(CHANGED_DURING_FREEZE);
    }
}
