type ArticulationNote = {
    id: string;
    pitch: number;
    startBeat: number;
    duration: number;
    articulation?: string;
};

type ProjectMidiArticulationTransferInput = {
    sourceNotes: readonly ArticulationNote[];
    targetNotes: readonly ArticulationNote[];
};

export type ProjectedMidiArticulationPair = {
    sourceNoteId: string;
    targetNoteId: string;
    sourceArticulation: string | null;
    currentTargetArticulation: string | null;
    relativeStartBeat: number;
    duration: number;
    voiceOrdinal: number;
};

function timingKey(note: ArticulationNote): string {
    return `${String(note.startBeat)}\u0000${String(note.duration)}`;
}

function orderVoices(left: ArticulationNote, right: ArticulationNote): number {
    return left.pitch - right.pitch || left.id.localeCompare(right.id);
}

export function projectMidiArticulationTransfer(
    input: ProjectMidiArticulationTransferInput
): ProjectedMidiArticulationPair[] | null {
    if (input.sourceNotes.length === 0 || input.sourceNotes.length !== input.targetNotes.length) {
        return null;
    }
    if (
        new Set(input.sourceNotes.map((note) => note.id)).size !== input.sourceNotes.length ||
        new Set(input.targetNotes.map((note) => note.id)).size !== input.targetNotes.length
    ) {
        return null;
    }
    const sourceByTiming = new Map<string, ArticulationNote[]>();
    const targetByTiming = new Map<string, ArticulationNote[]>();
    for (const note of input.sourceNotes) {
        sourceByTiming.set(timingKey(note), [...(sourceByTiming.get(timingKey(note)) ?? []), note]);
    }
    for (const note of input.targetNotes) {
        targetByTiming.set(timingKey(note), [...(targetByTiming.get(timingKey(note)) ?? []), note]);
    }
    if (sourceByTiming.size !== targetByTiming.size) {
        return null;
    }
    const pairs: ProjectedMidiArticulationPair[] = [];
    for (const key of [...sourceByTiming.keys()].sort()) {
        const sourceVoices = [...(sourceByTiming.get(key) ?? [])].sort(orderVoices);
        const targetVoices = [...(targetByTiming.get(key) ?? [])].sort(orderVoices);
        if (sourceVoices.length !== targetVoices.length) {
            return null;
        }
        for (const [voiceOrdinal, source] of sourceVoices.entries()) {
            const target = targetVoices[voiceOrdinal];
            if (!target) {
                return null;
            }
            pairs.push({
                sourceNoteId: source.id,
                targetNoteId: target.id,
                sourceArticulation: source.articulation ?? null,
                currentTargetArticulation: target.articulation ?? null,
                relativeStartBeat: source.startBeat,
                duration: source.duration,
                voiceOrdinal,
            });
        }
    }
    return pairs;
}
