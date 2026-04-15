import { updateNotesForClip } from './updateNotesForClip';

export function setNoteVelocities(clipId: string, updates: { noteId: string; velocity: number }[]): void {
    const updateMap = new Map(updates.map((u) => [u.noteId, Math.max(0, Math.min(127, u.velocity))]));
    updateNotesForClip(clipId, (notes) =>
        notes.map((n) => {
            const newVel = updateMap.get(n.id);
            return newVel !== undefined ? { ...n, velocity: newVel } : n;
        })
    );
}
