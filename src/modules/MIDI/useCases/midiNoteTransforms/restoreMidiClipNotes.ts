import { type MidiClipNoteSnapshot } from '#/utils/handlerContract';

import { midiStore } from '../../stores/midiStore';
import { midiNotesEqual } from '../../transformers/midiNotesEqual';

type RestoreMidiClipNotesInput = {
    clipId: string;
    notes: readonly MidiClipNoteSnapshot[];
    expectedNotes: readonly MidiClipNoteSnapshot[];
    allowMissingExpectedEmpty?: boolean;
};

export function restoreMidiClipNotes({
    clipId,
    notes,
    expectedNotes,
    allowMissingExpectedEmpty = false,
}: RestoreMidiClipNotesInput): 'written' | 'no-write' | 'conflict' {
    const state = midiStore.value;
    if (!state) {
        return 'conflict';
    }
    const storedNotes = state.notesByClipId[clipId];
    const canTreatMissingAsEmpty = storedNotes === undefined && allowMissingExpectedEmpty && expectedNotes.length === 0;
    if (storedNotes === undefined && !canTreatMissingAsEmpty) {
        return 'conflict';
    }
    const currentNotes = storedNotes ?? [];
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
