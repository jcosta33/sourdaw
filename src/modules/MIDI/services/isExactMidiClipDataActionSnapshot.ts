import { type MidiClipDataActionSnapshot } from '#/utils/handlerContract';
import { isRecord } from '#/utils/structuralEquality';

import { decodeMidiClipDataSnapshots } from './decodeMidiClipDataSnapshots';

// String keys only: rows read back from the project document carry the CRDT's
// own symbol-keyed object metadata, which is not content.
function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
    return keys.every((key) => Object.hasOwn(value, key)) && Object.keys(value).every((key) => keys.includes(key));
}

function isSlot(value: unknown): value is { present: boolean; value: unknown[] } {
    return (
        isRecord(value) &&
        hasExactKeys(value, ['present', 'value']) &&
        typeof value.present === 'boolean' &&
        Array.isArray(value.value) &&
        (value.present || value.value.length === 0)
    );
}

/** Validate the split capture's slot shape before its rows reach a sanitizing store. */
export function isExactMidiClipDataActionSnapshot(value: unknown): value is MidiClipDataActionSnapshot {
    if (!isRecord(value) || !hasExactKeys(value, ['notes', 'controlChanges', 'pitchBends'])) {
        return false;
    }
    const { notes, controlChanges, pitchBends } = value;
    if (!isSlot(notes) || !isSlot(controlChanges) || !isSlot(pitchBends)) {
        return false;
    }
    return (
        decodeMidiClipDataSnapshots({
            notesSnapshot: notes.value,
            controlChangeSnapshot: controlChanges.value,
            pitchBendSnapshot: pitchBends.value,
        }) !== null
    );
}
