import { updateNotesForClip } from '../midiNoteCrud/updateNotesForClip';

export function scaleAllVelocities(clipId: string, factor: number): void {
    updateNotesForClip(clipId, (notes) =>
        notes.map((n) => ({
            ...n,
            velocity: Math.max(1, Math.min(127, Math.round(n.velocity * factor))),
        }))
    );
}
