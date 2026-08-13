import { type MidiClipNoteSnapshot } from '#/utils/handlerContract';

import { midiStore } from '../../stores/midiStore';
import { copyMidiArticulationsToNotes } from '../../transformers/copyMidiArticulationsToNotes';

import { getCopyMidiArticulationsStatus } from './getCopyMidiArticulationsStatus';

type CopyMidiArticulationsInput = {
    trackId: string;
    sourceClipId: string;
    targetClipId: string;
    notePairs: readonly { sourceNoteId: string; targetNoteId: string }[];
    expectedSourceNotes: readonly MidiClipNoteSnapshot[];
    expectedTargetNotes: readonly MidiClipNoteSnapshot[];
    expectedTrackFrozen: boolean;
    expectedSourceClipLocked: boolean;
    expectedTargetClipLocked: boolean;
};

export function copyMidiArticulations(input: CopyMidiArticulationsInput): 'written' | 'no-write' | 'conflict' {
    const status = getCopyMidiArticulationsStatus(input);
    if (status !== 'written') {
        return status;
    }
    const state = midiStore.value;
    const sourceNotes = state?.notesByClipId[input.sourceClipId];
    const targetNotes = state?.notesByClipId[input.targetClipId];
    if (!state || !sourceNotes || !targetNotes) {
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
    midiStore.set({
        ...state,
        notesByClipId: { ...state.notesByClipId, [input.targetClipId]: nextTargetNotes },
    });
    return 'written';
}
