import { DEFAULT_NOTE_PROBABILITY } from '#/utils/midiData';

import { createMidiNote } from '../../models/MidiNote';
import { sliceMidiNoteExtent } from '../../services/sliceMidiNoteExtent';
import { updateNotesForClip } from '../midiNoteCrud/updateNotesForClip';

/**
 * Splits each selected note that spans the given beat position into two notes (R-A5).
 *
 * Both halves retain the original note's velocity and expression data. Recorded
 * expression stays where it was performed: the left half keeps the points
 * before the split, and the right half starts from the value in effect at the
 * split and keeps the rest.
 * Notes that do not span the beat are left unchanged.
 * The split beat must be strictly inside the note (not at start or end).
 */
export function splitNoteAtBeat(clipId: string, selectedIds: string[], beat: number): void {
    if (selectedIds.length === 0) {
        return;
    }
    const idSet = new Set(selectedIds);

    updateNotesForClip(clipId, (notes) => {
        const result = [];
        for (const note of notes) {
            if (!idSet.has(note.id)) {
                result.push(note);
                continue;
            }

            const noteEnd = note.startBeat + note.duration;
            // Only split if beat is strictly inside the note
            if (beat <= note.startBeat || beat >= noteEnd) {
                result.push(note);
                continue;
            }

            const splitOffset = beat - note.startBeat;
            const rightDuration = noteEnd - beat;

            result.push(sliceMidiNoteExtent(note, { fromOffset: 0, duration: splitOffset }));
            result.push({
                ...sliceMidiNoteExtent(note, { fromOffset: splitOffset, duration: rightDuration }),
                id: createMidiNote(note.pitch, beat, rightDuration).id,
                startBeat: beat,
                probability: note.probability ?? DEFAULT_NOTE_PROBABILITY,
            });
        }
        return result;
    });
}
