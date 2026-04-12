import { updateNotesForClip } from '../midiNoteCrud/updateNotesForClip';

export function invertNotes(clipId: string): void {
    updateNotesForClip(clipId, (notes) => {
        if (notes.length < 2) {
            return notes;
        }

        const pitches = notes.map((n) => n.pitch);
        const minPitch = Math.min(...pitches);
        const maxPitch = Math.max(...pitches);
        const axis = minPitch + maxPitch;

        return notes.map((n) => ({
            ...n,
            pitch: Math.max(0, Math.min(127, axis - n.pitch)),
        }));
    });
}
