import { updateNotesForClip } from './updateNotesForClip';

export function setNotePressure(clipId: string, noteId: string, pressure: number): void {
    updateNotesForClip(clipId, (notes) =>
        notes.map((n) => (n.id === noteId ? { ...n, pressure } : n))
    );
}
