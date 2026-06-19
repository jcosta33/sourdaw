import { type MidiNote } from '../../models/MidiNote';
import { updateNotesForClip } from '../midiNoteCrud/updateNotesForClip';

/**
 * Merges adjacent selected notes on the same pitch into single notes (R-A6).
 *
 * Two notes are considered adjacent when the gap between the end of the first and
 * the start of the next is within a musically-meaningful tolerance — an eighth of
 * `gridSize`. A fixed sub-millibeat tolerance silently failed to merge notes after
 * humanize / quantize(strength<1), which leave residual timing jitter far larger
 * than 0.001 beats yet still perceptually adjacent. Velocity takes the first note's
 * value. Non-adjacent notes or notes on different pitches within the selection are
 * left unchanged.
 *
 * `gridSize` defaults to one beat (a quarter note in 4/4) when the caller has no
 * grid context.
 */
export function joinNotes(clipId: string, selectedIds: string[], gridSize: number = 1): void {
    if (selectedIds.length < 2) {
        return;
    }
    const idSet = new Set(selectedIds);

    // Tolerate gaps up to an eighth of the grid: large enough to absorb humanize /
    // partial-quantize jitter, small enough not to swallow a genuine rest.
    const adjacencyTolerance = Math.abs(gridSize) / 8;

    updateNotesForClip(clipId, (notes) => {
        const selected = notes.filter((node) => idSet.has(node.id));

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
            const sorted = [...group].sort((alpha, b) => alpha.startBeat - b.startBeat);

            let index = 0;
            while (index < sorted.length) {
                let jIndex = index;
                // Extend the run while notes are adjacent (end of j meets start of j+1)
                while (
                    jIndex + 1 < sorted.length &&
                    Math.abs(sorted[jIndex]!.startBeat + sorted[jIndex]!.duration - sorted[jIndex + 1]!.startBeat) <=
                        adjacencyTolerance
                ) {
                    jIndex++;
                }

                if (jIndex > index) {
                    // Merge notes i..j into one
                    const first = sorted[index]!;
                    const last = sorted[jIndex]!;
                    toAdd.push({
                        ...first,
                        duration: last.startBeat + last.duration - first.startBeat,
                    });
                    for (let kIndex = index; kIndex <= jIndex; kIndex++) {
                        toRemove.add(sorted[kIndex]!.id);
                    }
                }
                index = jIndex + 1;
            }
        }

        if (toRemove.size === 0) {
            return notes;
        }

        return [...notes.filter((node) => !toRemove.has(node.id)), ...toAdd];
    });
}
