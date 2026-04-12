import { updateNotesForClip } from '../midiNoteCrud/updateNotesForClip';

export function quantizeNoteLengths(clipId: string, gridSize: number): void {
    updateNotesForClip(clipId, (notes) =>
        notes.map((n) => ({
            ...n,
            duration: Math.max(gridSize, Math.round(n.duration / gridSize) * gridSize),
        }))
    );
}
