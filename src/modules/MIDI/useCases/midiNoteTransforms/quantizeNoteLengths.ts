import { updateNotesForClip } from '../midiNoteCrud/updateNotesForClip';

export function quantizeNoteLengths(clipId: string, gridSize: number): void {
    updateNotesForClip(clipId, (notes) =>
        notes.map((node) => ({
            ...node,
            duration: Math.max(gridSize, Math.round(node.duration / gridSize) * gridSize),
        }))
    );
}
