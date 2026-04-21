import { type MidiNote } from '../../models/MidiNote';
import { updateNotesForClip } from '../midiNoteCrud/updateNotesForClip';

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
                    Math.abs(sorted[jIndex]!.startBeat + sorted[jIndex]!.duration - sorted[jIndex + 1]!.startBeat) <
                        0.001
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
