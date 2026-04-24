import { updateNotesForClip } from './updateNotesForClip';

export function removeMidiNote(clipId: string, noteId: string): void {
    updateNotesForClip(clipId, (notes) => notes.filter((node) => node.id !== noteId));
}
