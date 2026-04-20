import { updateNotesForClip } from '../midiNoteCrud/updateNotesForClip';

/**
 * Extends or contracts each selected note's duration so its end meets
 * the start of the next note on the same pitch (R-A4).
 *
 * Fallback: if no subsequent note exists on the same pitch, extends to
 * the start of the next note on any pitch within the selection.
 *
 * Notes that have no subsequent note (same or any pitch) are left unchanged.
 */
export function legatoNotes(clipId: string, selectedIds: string[]): void {
    if (selectedIds.length === 0) {
        return;
    }
    const idSet = new Set(selectedIds);

    updateNotesForClip(clipId, (notes) => {
        return notes.map((note) => {
            if (!idSet.has(note.id)) {
                return note;
            }

            // Find next note on same pitch after this note's start
            let targetEnd: number | null = null;
            let bestBeat = Infinity;
            for (const candidate of notes) {
                if (
                    candidate.id !== note.id &&
                    candidate.pitch === note.pitch &&
                    candidate.startBeat > note.startBeat
                ) {
                    if (candidate.startBeat < bestBeat) {
                        bestBeat = candidate.startBeat;
                        targetEnd = candidate.startBeat;
                    }
                }
            }

            if (targetEnd === null) {
                // Fallback: next note on any pitch in the selection
                bestBeat = Infinity;
                for (const candidate of notes) {
                    if (idSet.has(candidate.id) && candidate.startBeat > note.startBeat) {
                        if (candidate.startBeat < bestBeat) {
                            bestBeat = candidate.startBeat;
                            targetEnd = candidate.startBeat;
                        }
                    }
                }
            }

            if (targetEnd === null) {
                return note;
            }

            const newDuration = Math.max(0.0625, targetEnd - note.startBeat);
            return { ...note, duration: newDuration };
        });
    });
}
