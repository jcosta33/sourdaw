import { updateNotesForClip } from '../midiNoteCrud/updateNotesForClip';

export function invertNotes(clipId: string): void {
    updateNotesForClip(clipId, (notes) => {
        if (notes.length < 2) {
            return notes;
        }

        let minPitch = Infinity;
        let maxPitch = -Infinity;
        for (const n of notes) {
            if (n.pitch < minPitch) { minPitch = n.pitch; }
            if (n.pitch > maxPitch) { maxPitch = n.pitch; }
        }
        const axis = minPitch + maxPitch;

        return notes.map((n) => ({
            ...n,
            pitch: Math.max(0, Math.min(127, axis - n.pitch)),
        }));
    });
}
