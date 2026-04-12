import { updateNotesForClip } from '#/modules/MIDI/useCases/midiNoteCrud/updateNotesForClip';

export function removeMidiNote(clipId: string, noteId: string): void {
    updateNotesForClip(clipId, (notes) => notes.filter((n) => n.id !== noteId));
}
