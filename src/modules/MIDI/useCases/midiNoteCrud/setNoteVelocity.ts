import { updateNotesForClip } from './updateNotesForClip';

export function setNoteVelocity(clipId: string, noteId: string, velocity: number): void {
    updateNotesForClip(clipId, (notes) =>
        notes.map((n) => (n.id === noteId ? { ...n, velocity: Math.max(0, Math.min(127, velocity)) } : n))
    );
}
