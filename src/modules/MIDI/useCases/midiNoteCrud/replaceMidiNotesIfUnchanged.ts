import { type MidiNote } from '../../models/MidiNote';
import { midiStore } from '../../stores/midiStore';
import { cloneMidiNoteForAdmission } from '../../transformers/cloneMidiNoteForAdmission';
import { isMidiNoteSnapshot } from '../../transformers/isMidiNoteSnapshot';
import { midiNotesEqual } from '../../transformers/midiNotesEqual';

type MidiNoteReplacement = {
    expected: MidiNote;
    replacement: MidiNote;
};

/** Restore edited note identities without replacing unrelated, subsequently edited clip notes. */
export function replaceMidiNotesIfUnchanged(clipId: string, replacements: readonly MidiNoteReplacement[]): void {
    if (replacements.length === 0) {
        return;
    }
    const state = midiStore.value;
    const current = state?.notesByClipId[clipId];
    const expected = replacements.map((entry) => entry.expected);
    const replacement = replacements.map((entry) => entry.replacement);
    if (
        !state ||
        !current ||
        !isMidiNoteSnapshot(expected) ||
        !isMidiNoteSnapshot(replacement) ||
        expected.some((note, index) => note.id !== replacement[index]?.id)
    ) {
        throw new Error('Cannot restore MIDI notes: captured notes are invalid or missing');
    }

    const replacementById = new Map(
        replacements.map((entry) => [entry.expected.id, cloneMidiNoteForAdmission(entry.replacement)])
    );
    const liveOwners = new Map<string, string[]>();
    for (const [liveClipId, notes] of Object.entries(state.notesByClipId)) {
        for (const note of notes) {
            if (!replacementById.has(note.id)) {
                continue;
            }
            const owners = liveOwners.get(note.id) ?? [];
            owners.push(liveClipId);
            liveOwners.set(note.id, owners);
        }
    }
    for (const entry of replacements) {
        const owners = liveOwners.get(entry.expected.id);
        if (!owners || owners.length !== 1 || owners[0] !== clipId) {
            throw new Error('Cannot restore MIDI notes: note ownership changed');
        }
        const live = current.find((note) => note.id === entry.expected.id);
        if (!live || !midiNotesEqual([live], [entry.expected])) {
            throw new Error('Cannot restore MIDI notes: an edited note changed');
        }
    }

    midiStore.set({
        ...state,
        notesByClipId: {
            ...state.notesByClipId,
            [clipId]: current.map((note) => replacementById.get(note.id) ?? note),
        },
    });
}
