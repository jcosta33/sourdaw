type MidiArticulationSnapshot = {
    readonly id: string;
    readonly articulation?: string;
};

type GetMidiArticulationSemanticChangesInput = {
    notePairs: readonly { readonly sourceNoteId: string; readonly targetNoteId: string }[];
    sourceNotes: readonly MidiArticulationSnapshot[];
    targetNotes: readonly MidiArticulationSnapshot[];
};

export type MidiArticulationSemanticChange = {
    sourceNoteId: string;
    targetNoteId: string;
    sourceArticulation: string | null;
    currentTargetArticulation: string | null;
};

export function getMidiArticulationSemanticChanges(
    input: GetMidiArticulationSemanticChangesInput
): MidiArticulationSemanticChange[] | null {
    const sourceById = new Map(input.sourceNotes.map((note) => [note.id, note]));
    const targetById = new Map(input.targetNotes.map((note) => [note.id, note]));
    const seenSourceIds = new Set<string>();
    const seenTargetIds = new Set<string>();
    const changes: MidiArticulationSemanticChange[] = [];

    for (const pair of input.notePairs) {
        const source = sourceById.get(pair.sourceNoteId);
        const target = targetById.get(pair.targetNoteId);
        if (!source || !target || seenSourceIds.has(pair.sourceNoteId) || seenTargetIds.has(pair.targetNoteId)) {
            return null;
        }
        seenSourceIds.add(pair.sourceNoteId);
        seenTargetIds.add(pair.targetNoteId);
        const sourceArticulation = source.articulation ?? null;
        const currentTargetArticulation = target.articulation ?? null;
        if (sourceArticulation !== currentTargetArticulation) {
            changes.push({
                sourceNoteId: pair.sourceNoteId,
                targetNoteId: pair.targetNoteId,
                sourceArticulation,
                currentTargetArticulation,
            });
        }
    }

    return changes;
}
