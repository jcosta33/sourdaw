import { updateNotesForClip } from './updateNotesForClip';

export function setNoteVelocities(clipId: string, updates: { noteId: string; velocity: number }[]): void {
    const updateMap = new Map(updates.map((user) => [user.noteId, Math.max(0, Math.min(127, user.velocity))]));
    updateNotesForClip(clipId, (notes) =>
        notes.map((node) => {
            const newVel = updateMap.get(node.id);
            return newVel !== undefined ? { ...node, velocity: newVel } : node;
        })
    );
}
