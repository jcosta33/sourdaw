import { createMidiNote } from '../../models/MidiNote';
import { updateNotesForClip } from '../midiNoteCrud/updateNotesForClip';

/**
 * Splits each selected note that spans the given beat position into two notes (R-A5).
 *
 * Both halves retain the original note's velocity and expression data.
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

            const leftDuration = beat - note.startBeat;
            const rightDuration = noteEnd - beat;

            result.push({ ...note, duration: leftDuration });
            result.push({
                ...createMidiNote(note.pitch, beat, rightDuration, note.velocity, note.probability ?? 100),
                pressure: note.pressure,
                slide: note.slide,
                pitchBend: note.pitchBend,
                pitchBendRangeSemitones: note.pitchBendRangeSemitones,
                channel: note.channel,
                articulation: note.articulation,
            });
        }
        return result;
    });
}
