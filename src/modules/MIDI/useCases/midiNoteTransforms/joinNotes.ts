import { updateNotesForClip } from '../midiNoteCrud/updateNotesForClip';
import { type MidiNote } from '../../models/MidiNote';

/**
 * Merges adjacent selected notes on the same pitch into single notes (R-A6).
 *
 * Two notes are considered adjacent when the end of the first equals (within 0.001 beats)
 * the start of the next. Velocity takes the first note's value. Non-adjacent notes
 * or notes on different pitches within the selection are left unchanged.
 */
export function joinNotes(clipId: string, selectedIds: string[]): void {
    if (selectedIds.length < 2) {
        return;
    }
    const idSet = new Set(selectedIds);

    updateNotesForClip(clipId, (notes) => {
        const selected = notes.filter((n) => idSet.has(n.id));

        // Group by pitch
        const byPitch = new Map<number, MidiNote[]>();
        for (const note of selected) {
            const group = byPitch.get(note.pitch) ?? [];
            group.push(note);
            byPitch.set(note.pitch, group);
        }

        const toRemove = new Set<string>();
        const toAdd: MidiNote[] = [];

        for (const [, group] of byPitch) {
            const sorted = [...group].sort((a, b) => a.startBeat - b.startBeat);

            let i = 0;
            while (i < sorted.length) {
                let j = i;
                // Extend the run while notes are adjacent (end of j meets start of j+1)
                while (
                    j + 1 < sorted.length &&
                    Math.abs(sorted[j]!.startBeat + sorted[j]!.duration - sorted[j + 1]!.startBeat) < 0.001
                ) {
                    j++;
                }

                if (j > i) {
                    // Merge notes i..j into one
                    const first = sorted[i]!;
                    const last = sorted[j]!;
                    toAdd.push({
                        ...first,
                        duration: last.startBeat + last.duration - first.startBeat,
                    });
                    for (let k = i; k <= j; k++) {
                        toRemove.add(sorted[k]!.id);
                    }
                }
                i = j + 1;
            }
        }

        if (toRemove.size === 0) {
            return notes;
        }

        return [...notes.filter((n) => !toRemove.has(n.id)), ...toAdd];
    });
}
