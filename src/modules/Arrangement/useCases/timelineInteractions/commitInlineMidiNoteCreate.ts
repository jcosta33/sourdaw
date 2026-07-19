import { runLegacyCommandMutation } from '#/modules/Command/useCases';
import { addMidiNote, getNotesForClip, setNotesForClip } from '#/modules/MIDI/useCases';

type CommitInlineMidiNoteCreateInput = {
    clipId: string;
    pitch: number;
    startBeat: number;
    duration: number;
    velocity: number;
};

export function commitInlineMidiNoteCreate(input: CommitInlineMidiNoteCreateInput): Promise<boolean> {
    return runLegacyCommandMutation((pushUndoEntry) => {
        const previousNotes = getNotesForClip(input.clipId);
        addMidiNote(input.clipId, input.pitch, input.startBeat, input.duration, input.velocity);
        const nextNotes = getNotesForClip(input.clipId);

        pushUndoEntry(
            'Draw MIDI note',
            () => setNotesForClip(input.clipId, previousNotes),
            () => setNotesForClip(input.clipId, nextNotes)
        );

        return nextNotes.length !== previousNotes.length;
    });
}
