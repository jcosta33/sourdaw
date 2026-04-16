import { updateNotesForClip } from './updateNotesForClip';

export function setNoteSlide(clipId: string, noteId: string, slide: number): void {
    updateNotesForClip(clipId, (notes) =>
        notes.map((n) => (n.id === noteId ? { ...n, slide } : n))
    );
}
