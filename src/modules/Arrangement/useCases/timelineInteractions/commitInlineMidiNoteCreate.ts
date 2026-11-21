import { pushUndoEntry } from '#/modules/Command/useCases';
import { addMidiNote, getNotesForClip, setNotesForClip } from '#/modules/MIDI/useCases';

import { refuseInlineMidiEditOnFrozenTrack } from './refuseInlineMidiEditOnFrozenTrack';

type CommitInlineMidiNoteCreateInput = {
    clipId: string;
    pitch: number;
    startBeat: number;
    duration: number;
    velocity: number;
};

export function commitInlineMidiNoteCreate(input: CommitInlineMidiNoteCreateInput): boolean {
    if (refuseInlineMidiEditOnFrozenTrack(input.clipId)) {
        return false;
    }
    const previousNotes = getNotesForClip(input.clipId);
    addMidiNote(input.clipId, input.pitch, input.startBeat, input.duration, input.velocity);
    const nextNotes = getNotesForClip(input.clipId);

    pushUndoEntry(
        'Draw MIDI note',
        () => setNotesForClip(input.clipId, previousNotes),
        () => setNotesForClip(input.clipId, nextNotes)
    );

    return nextNotes.length !== previousNotes.length;
}
