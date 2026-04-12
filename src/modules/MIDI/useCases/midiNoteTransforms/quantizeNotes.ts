import { updateNotesForClip } from '../midiNoteCrud/updateNotesForClip';

export function quantizeNotes(clipId: string, gridSize: number): void {
    updateNotesForClip(clipId, (notes) =>
        notes.map((n) => ({
            ...n,
            startBeat: Math.round(n.startBeat / gridSize) * gridSize,
        }))
    );
}
