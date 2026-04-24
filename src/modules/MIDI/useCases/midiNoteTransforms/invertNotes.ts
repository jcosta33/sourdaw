import { updateNotesForClip } from '../midiNoteCrud/updateNotesForClip';

export function invertNotes(clipId: string): void {
    updateNotesForClip(clipId, (notes) => {
        if (notes.length < 2) {
            return notes;
        }

        let minPitch = Infinity;
        let maxPitch = -Infinity;
        for (const node of notes) {
            if (node.pitch < minPitch) {
                minPitch = node.pitch;
            }
            if (node.pitch > maxPitch) {
                maxPitch = node.pitch;
            }
        }
        const axis = minPitch + maxPitch;

        return notes.map((node) => ({
            ...node,
            pitch: Math.max(0, Math.min(127, axis - node.pitch)),
        }));
    });
}
