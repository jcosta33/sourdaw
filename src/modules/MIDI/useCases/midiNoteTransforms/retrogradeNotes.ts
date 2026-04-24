import { updateNotesForClip } from '../midiNoteCrud/updateNotesForClip';

export function retrogradeNotes(clipId: string): void {
    updateNotesForClip(clipId, (notes) => {
        if (notes.length < 2) {
            return notes;
        }

        let minStart = Infinity;
        let maxEnd = -Infinity;
        for (const node of notes) {
            if (node.startBeat < minStart) {
                minStart = node.startBeat;
            }
            const end = node.startBeat + node.duration;
            if (end > maxEnd) {
                maxEnd = end;
            }
        }
        const totalLength = maxEnd - minStart;

        return notes.map((node) => ({
            ...node,
            startBeat: minStart + totalLength - (node.startBeat - minStart) - node.duration,
        }));
    });
}
