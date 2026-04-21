import { updateNotesForClip } from '../midiNoteCrud/updateNotesForClip';

export function transposeNotes(clipId: string, semitones: number): void {
    updateNotesForClip(clipId, (notes) =>
        notes.map((node) => ({
            ...node,
            pitch: Math.max(0, Math.min(127, node.pitch + semitones)),
        }))
    );
}
