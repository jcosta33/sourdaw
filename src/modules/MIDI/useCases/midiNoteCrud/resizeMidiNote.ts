import { sliceMidiNoteExtent } from '../../services/sliceMidiNoteExtent';

import { updateNotesForClip } from './updateNotesForClip';

/**
 * Sets a note's start edge and/or duration. Recorded expression stays at the
 * beats where it was performed: a later start begins from the value in effect
 * there, an earlier one holds the note-on value until the first point, and
 * points at or past the new end are dropped.
 */
export function resizeMidiNote(clipId: string, noteId: string, newStartBeat?: number, newDuration?: number): void {
    updateNotesForClip(clipId, (notes) =>
        notes.map((node) => {
            if (node.id !== noteId) {
                return node;
            }
            const startBeat = newStartBeat !== undefined ? newStartBeat : node.startBeat;
            const duration = newDuration !== undefined ? Math.max(0.0625, newDuration) : node.duration;
            return {
                ...sliceMidiNoteExtent(node, { fromOffset: startBeat - node.startBeat, duration }),
                startBeat,
            };
        })
    );
}
