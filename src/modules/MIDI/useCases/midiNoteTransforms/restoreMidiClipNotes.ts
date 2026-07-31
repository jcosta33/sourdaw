import { type MidiClipNoteSnapshot } from '#/utils/handlerContract';

import { midiStore } from '../../stores/midiStore';
import { midiNotesEqual } from '../../transformers/midiNotesEqual';

type RestoreMidiClipNotesInput = {
    clipId: string;
    notes: readonly MidiClipNoteSnapshot[];
    expectedNotes: readonly MidiClipNoteSnapshot[];
};

export function restoreMidiClipNotes({
    clipId,
    notes,
    expectedNotes,
}: RestoreMidiClipNotesInput): 'written' | 'no-write' | 'conflict' {
    const state = midiStore.value;
    const currentNotes = state?.notesByClipId[clipId];
    if (!state || !currentNotes) {
        return 'conflict';
    }
    if (midiNotesEqual(currentNotes, notes)) {
        return 'no-write';
    }
    if (!midiNotesEqual(currentNotes, expectedNotes)) {
        return 'conflict';
    }

    midiStore.set({
        ...state,
        notesByClipId: {
            ...state.notesByClipId,
            [clipId]: notes.map((note) => ({ ...note })),
        },
    });
    return 'written';
}
