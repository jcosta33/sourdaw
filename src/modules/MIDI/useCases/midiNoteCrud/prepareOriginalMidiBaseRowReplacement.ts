import { type OriginalMidiBaseRowReplacementPayload } from '#/utils/handlerContract';
import { valuesEqual } from '#/utils/structuralEquality';

import { type MidiStoreState } from '../../stores/midiStore';
import { isMidiNoteSnapshot } from '../../transformers/isMidiNoteSnapshot';

function isValidReplacement(payload: OriginalMidiBaseRowReplacementPayload): boolean {
    return (
        Boolean(payload.clipId) &&
        Boolean(payload.rowId) &&
        (payload.expected !== null || payload.replacement !== null) &&
        (payload.expected === null ||
            (payload.expected.id === payload.rowId && isMidiNoteSnapshot([payload.expected]))) &&
        (payload.replacement === null ||
            (payload.replacement.id === payload.rowId && isMidiNoteSnapshot([payload.replacement])))
    );
}

/** Replace only the witnessed original row, leaving peer rows in their current order and state. */
export function prepareOriginalMidiBaseRowReplacement(
    payload: OriginalMidiBaseRowReplacementPayload,
    state: MidiStoreState | null
): MidiStoreState | null {
    if (!state || !isValidReplacement(payload)) {
        return null;
    }
    const present = Object.hasOwn(state.notesByClipId, payload.clipId);
    if (present !== payload.expectedSlotPresent) {
        return null;
    }
    const rows = state.notesByClipId[payload.clipId] ?? [];
    if (!isMidiNoteSnapshot(rows)) {
        return null;
    }
    const matching = rows.findIndex((row) => row.id === payload.rowId);
    if (payload.expected === null ? matching >= 0 : matching < 0 || !valuesEqual(rows[matching], payload.expected)) {
        return null;
    }
    for (const [clipId, notes] of Object.entries(state.notesByClipId)) {
        if (clipId !== payload.clipId && notes.some((note) => note.id === payload.rowId)) {
            return null;
        }
    }
    const nextRows = [...rows];
    if (payload.expected === null && payload.replacement !== null) {
        nextRows.push(structuredClone(payload.replacement));
    } else if (payload.replacement === null) {
        nextRows.splice(matching, 1);
    } else {
        nextRows[matching] = structuredClone(payload.replacement);
    }
    if (!payload.replacementSlotPresent && nextRows.length > 0) {
        return null;
    }
    const notesByClipId = { ...state.notesByClipId, [payload.clipId]: nextRows };
    if (payload.replacementSlotPresent) {
        notesByClipId[payload.clipId] = nextRows;
    } else {
        delete notesByClipId[payload.clipId];
    }
    return { ...state, notesByClipId };
}
