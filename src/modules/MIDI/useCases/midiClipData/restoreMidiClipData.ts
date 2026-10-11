import { midiStore } from '../../stores/midiStore';
import { cloneMidiNoteForAdmission } from '../../transformers/cloneMidiNoteForAdmission';

import { decodeMidiClipDataSnapshots } from './decodeMidiClipDataSnapshots';

const INVALID_MIDI_CLIP_DATA_SNAPSHOT = 'Invalid MIDI clip data snapshot';

type RestoreMidiClipDataInput = {
    clipId: string;
    notesSnapshot: readonly unknown[] | null;
    controlChangeSnapshot: readonly unknown[] | null;
    pitchBendSnapshot: readonly unknown[] | null;
};

export function restoreMidiClipData({
    clipId,
    notesSnapshot,
    controlChangeSnapshot,
    pitchBendSnapshot,
}: RestoreMidiClipDataInput): void {
    const state = midiStore.value;
    if (!state) {
        return;
    }

    if (notesSnapshot === null && controlChangeSnapshot === null && pitchBendSnapshot === null) {
        return;
    }

    const snapshots = decodeMidiClipDataSnapshots({ notesSnapshot, controlChangeSnapshot, pitchBendSnapshot });
    if (!snapshots) {
        throw new TypeError(INVALID_MIDI_CLIP_DATA_SNAPSHOT);
    }
    const {
        notesSnapshot: validatedNotes,
        controlChangeSnapshot: validatedControlChanges,
        pitchBendSnapshot: validatedPitchBends,
    } = snapshots;

    midiStore.set({
        ...state,
        notesByClipId:
            validatedNotes === null
                ? state.notesByClipId
                : {
                      ...state.notesByClipId,
                      [clipId]: validatedNotes.map((note) =>
                          note.expression === undefined ? note : cloneMidiNoteForAdmission(note)
                      ),
                  },
        ccByClipId:
            validatedControlChanges === null
                ? state.ccByClipId
                : { ...state.ccByClipId, [clipId]: [...validatedControlChanges] },
        pitchBendByClipId:
            validatedPitchBends === null
                ? state.pitchBendByClipId
                : { ...state.pitchBendByClipId, [clipId]: [...validatedPitchBends] },
    });
}
