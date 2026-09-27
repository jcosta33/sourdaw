import { type MidiNote } from '../../models/MidiNote';
import { midiStore } from '../../stores/midiStore';
import { isMidiNoteSnapshot } from '../../transformers/isMidiNoteSnapshot';
import { midiNotesEqual } from '../../transformers/midiNotesEqual';

export type MidiNoteMembershipPlan = Readonly<{
    clipId: string;
    expected: readonly MidiNote[];
    replacement: readonly MidiNote[];
}>;

function sameNote(left: MidiNote, right: MidiNote): boolean {
    return midiNotesEqual([left], [right]);
}

function insertRelativeToCapturedOrder(notes: MidiNote[], target: readonly MidiNote[], added: MidiNote): void {
    const targetIndex = target.findIndex((note) => note.id === added.id);
    const next = target.slice(targetIndex + 1).find((note) => notes.some((live) => live.id === note.id));
    if (next) {
        notes.splice(
            notes.findIndex((note) => note.id === next.id),
            0,
            added
        );
        return;
    }
    const previous = target
        .slice(0, targetIndex)
        .reverse()
        .find((note) => notes.some((live) => live.id === note.id));
    if (previous) {
        notes.splice(notes.findIndex((note) => note.id === previous.id) + 1, 0, added);
        return;
    }
    notes.push(added);
}

/** Replay only the gesture's owned note changes after checking every clip before one publication. */
export function restoreMidiNoteMembershipIfUnchanged(plans: readonly MidiNoteMembershipPlan[]): void {
    if (plans.length === 0) {
        return;
    }
    const state = midiStore.value;
    if (!state) {
        throw new Error('Cannot restore MIDI notes: store is missing');
    }
    const clipIds = new Set<string>();
    const ownedIds = new Set<string>();
    const nextNotesByClipId = Object.assign({}, state.notesByClipId);
    for (const plan of plans) {
        const current = state.notesByClipId[plan.clipId];
        if (
            clipIds.has(plan.clipId) ||
            !current ||
            !isMidiNoteSnapshot(plan.expected) ||
            !isMidiNoteSnapshot(plan.replacement)
        ) {
            throw new Error('Cannot restore MIDI notes: captured clips are invalid or missing');
        }
        clipIds.add(plan.clipId);
        const expectedById = new Map(plan.expected.map((note) => [note.id, note]));
        const replacementById = new Map(plan.replacement.map((note) => [note.id, note]));
        const changedIds = new Set<string>();
        for (const id of new Set([...expectedById.keys(), ...replacementById.keys()])) {
            const expected = expectedById.get(id);
            const replacement = replacementById.get(id);
            if (expected && replacement && sameNote(expected, replacement)) {
                continue;
            }
            if (ownedIds.has(id)) {
                throw new Error('Cannot restore MIDI notes: overlapping note ownership');
            }
            ownedIds.add(id);
            changedIds.add(id);
            const live = current.find((note) => note.id === id);
            if (expected ? !live || !sameNote(live, expected) : live !== undefined) {
                throw new Error('Cannot restore MIDI notes: an edited note changed');
            }
        }
        const updated = current
            .filter((note) => !changedIds.has(note.id) || replacementById.has(note.id))
            .map((note) => {
                const replacement = changedIds.has(note.id) ? replacementById.get(note.id) : undefined;
                return replacement ? structuredClone(replacement) : note;
            });
        for (const note of plan.replacement) {
            if (changedIds.has(note.id) && !expectedById.has(note.id)) {
                insertRelativeToCapturedOrder(updated, plan.replacement, structuredClone(note));
            }
        }
        nextNotesByClipId[plan.clipId] = updated;
    }
    midiStore.set({ ...state, notesByClipId: nextNotesByClipId });
}
