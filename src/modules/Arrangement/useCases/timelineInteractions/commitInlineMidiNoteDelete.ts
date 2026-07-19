import { runLegacyCommandMutation } from '#/modules/Command/useCases';
import { getNotesForClip, setNotesForClip } from '#/modules/MIDI/useCases';

type CommitInlineMidiNoteDeleteInput = {
    clipId: string;
    noteId: string;
};

export function commitInlineMidiNoteDelete(input: CommitInlineMidiNoteDeleteInput): Promise<boolean> {
    return runLegacyCommandMutation((pushUndoEntry) => {
        const previousNotes = getNotesForClip(input.clipId);
        const targetNote = previousNotes.find((note) => note.id === input.noteId);
        if (!targetNote) {
            return false;
        }

        const nextNotes = previousNotes.filter((note) => note.id !== input.noteId);
        setNotesForClip(input.clipId, nextNotes);
        pushUndoEntry(
            'Delete MIDI note',
            () => setNotesForClip(input.clipId, previousNotes),
            () => setNotesForClip(input.clipId, nextNotes)
        );

        return true;
    });
}
