import { updateNotesForClip } from '../midiNoteCrud/updateNotesForClip';

export function retrogradeNotes(clipId: string): void {
    updateNotesForClip(clipId, (notes) => {
        if (notes.length < 2) {
            return notes;
        }

        let minStart = Infinity;
        let maxEnd = -Infinity;
        for (const n of notes) {
            if (n.startBeat < minStart) { minStart = n.startBeat; }
            const end = n.startBeat + n.duration;
            if (end > maxEnd) { maxEnd = end; }
        }
        const totalLength = maxEnd - minStart;

        return notes.map((n) => ({
            ...n,
            startBeat: minStart + totalLength - (n.startBeat - minStart) - n.duration,
        }));
    });
}
