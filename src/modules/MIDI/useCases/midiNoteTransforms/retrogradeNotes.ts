import { updateNotesForClip } from '../midiNoteCrud/updateNotesForClip';

export function retrogradeNotes(clipId: string): void {
    updateNotesForClip(clipId, (notes) => {
        if (notes.length < 2) {
            return notes;
        }

        const starts = notes.map((n) => n.startBeat);
        const minStart = Math.min(...starts);
        const maxEnd = Math.max(...notes.map((n) => n.startBeat + n.duration));
        const totalLength = maxEnd - minStart;

        return notes.map((n) => ({
            ...n,
            startBeat: minStart + totalLength - (n.startBeat - minStart) - n.duration,
        }));
    });
}
