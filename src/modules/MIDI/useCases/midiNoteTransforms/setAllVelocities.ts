import { updateNotesForClip } from '../midiNoteCrud/updateNotesForClip';

export function setAllVelocities(clipId: string, velocity: number): void {
    const clamped = Math.max(1, Math.min(127, velocity));

    updateNotesForClip(clipId, (notes) =>
        notes.map((n) => ({
            ...n,
            velocity: clamped,
        }))
    );
}
