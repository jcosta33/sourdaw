import { type MidiClipNoteSnapshot } from '#/utils/handlerContract';

import { midiStore } from '../../stores/midiStore';
import { copyMidiArticulationsToNotes } from '../../transformers/copyMidiArticulationsToNotes';
import { midiNotesEqual } from '../../transformers/midiNotesEqual';

type CopyMidiArticulationsInput = {
    sourceClipId: string;
    targetClipId: string;
    notePairs: readonly { sourceNoteId: string; targetNoteId: string }[];
    expectedSourceNotes: readonly MidiClipNoteSnapshot[];
    expectedTargetNotes: readonly MidiClipNoteSnapshot[];
};

export function copyMidiArticulations(input: CopyMidiArticulationsInput): 'written' | 'no-write' | 'conflict' {
    const state = midiStore.value;
    const sourceNotes = state?.notesByClipId[input.sourceClipId];
    const targetNotes = state?.notesByClipId[input.targetClipId];
    if (!state || !sourceNotes || !targetNotes) {
        return 'conflict';
    }
    if (
        !midiNotesEqual(sourceNotes, input.expectedSourceNotes) ||
        !midiNotesEqual(targetNotes, input.expectedTargetNotes)
    ) {
        return 'conflict';
    }
    const nextTargetNotes = copyMidiArticulationsToNotes({
        sourceNotes,
        targetNotes,
        notePairs: input.notePairs,
    });
    if (!nextTargetNotes) {
        return 'conflict';
    }
    if (midiNotesEqual(targetNotes, nextTargetNotes)) {
        return 'no-write';
    }
    midiStore.set({
        ...state,
        notesByClipId: { ...state.notesByClipId, [input.targetClipId]: nextTargetNotes },
    });
    return 'written';
}
