import { updateNotesForClip } from './updateNotesForClip';

export function setNotePitchBend(clipId: string, noteId: string, pitchBend: number): void {
    updateNotesForClip(clipId, (notes) =>
        notes.map((n) => (n.id === noteId ? { ...n, pitchBend } : n))
    );
}
