import { pushUndoEntry } from '#/modules/Command/useCases';
import { getNotesForClip, setNotesForClip } from '#/modules/MIDI/useCases';

type CommitInlineMidiNoteMoveInput = {
    clipId: string;
    noteId: string;
    pitch: number;
    startBeat: number;
};

export function commitInlineMidiNoteMove(input: CommitInlineMidiNoteMoveInput): boolean {
    const previousNotes = getNotesForClip(input.clipId);
    const targetNote = previousNotes.find((note) => note.id === input.noteId);
    if (!targetNote) {
        return false;
    }
    if (targetNote.pitch === input.pitch && targetNote.startBeat === input.startBeat) {
        return false;
    }

    const nextNotes = previousNotes.map((note) => {
        if (note.id !== input.noteId) {
            return note;
        }
        return { ...note, pitch: input.pitch, startBeat: input.startBeat };
    });

    setNotesForClip(input.clipId, nextNotes);
    pushUndoEntry(
        'Move MIDI note',
        () => setNotesForClip(input.clipId, previousNotes),
        () => setNotesForClip(input.clipId, nextNotes)
    );

    return true;
}
