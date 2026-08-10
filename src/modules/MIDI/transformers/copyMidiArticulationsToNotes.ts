import { type MidiNote } from '../models/MidiNote';

type CopyMidiArticulationsToNotesInput = {
    sourceNotes: readonly MidiNote[];
    targetNotes: readonly MidiNote[];
    notePairs: readonly { sourceNoteId: string; targetNoteId: string }[];
};

export function copyMidiArticulationsToNotes(input: CopyMidiArticulationsToNotesInput): MidiNote[] | null {
    if (input.notePairs.length !== input.sourceNotes.length || input.notePairs.length !== input.targetNotes.length) {
        return null;
    }
    const sourceById = new Map(input.sourceNotes.map((note) => [note.id, note]));
    const sourceIds = new Set<string>();
    const targetIds = new Set(input.targetNotes.map((note) => note.id));
    const targetArticulationById = new Map<string, string | undefined>();
    for (const pair of input.notePairs) {
        const source = sourceById.get(pair.sourceNoteId);
        if (
            !source ||
            sourceIds.has(pair.sourceNoteId) ||
            !targetIds.has(pair.targetNoteId) ||
            targetArticulationById.has(pair.targetNoteId)
        ) {
            return null;
        }
        sourceIds.add(pair.sourceNoteId);
        targetArticulationById.set(pair.targetNoteId, source.articulation);
    }
    if (sourceIds.size !== input.sourceNotes.length || targetArticulationById.size !== input.targetNotes.length) {
        return null;
    }
    return input.targetNotes.map((note) => {
        const articulation = targetArticulationById.get(note.id);
        if (articulation === undefined) {
            const { articulation: _articulation, ...withoutArticulation } = note;
            return withoutArticulation;
        }
        return { ...note, articulation };
    });
}
