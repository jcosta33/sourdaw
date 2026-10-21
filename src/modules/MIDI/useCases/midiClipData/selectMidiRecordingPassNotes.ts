import { type MidiNote } from '../../models/MidiNote';
import { sliceMidiNoteExtent } from '../../services/sliceMidiNoteExtent';

export type MidiRecordingPassWindow = {
    recordingPassId?: string;
    sourceStartBeat: number;
    sourceEndBeat: number;
};

/** Admit the onset's pass before loop, groove or probability projection.
 * Legacy clips retain their ordinary overlap and loop-window admission.
 */
export function selectMidiRecordingPassNotes(
    notes: readonly MidiNote[],
    window: MidiRecordingPassWindow
): readonly MidiNote[] {
    if (window.recordingPassId === undefined) {
        return notes;
    }
    return notes.flatMap((note) => {
        if (note.recordingPassId !== window.recordingPassId) {
            return [];
        }
        const start = Math.max(note.startBeat, window.sourceStartBeat);
        const end = Math.min(note.startBeat + note.duration, window.sourceEndBeat);
        if (note.duration === 0) {
            return note.startBeat >= window.sourceStartBeat && note.startBeat < window.sourceEndBeat ? [note] : [];
        }
        if (end <= start) {
            return [];
        }
        return start === note.startBeat && end === note.startBeat + note.duration
            ? [note]
            : [sliceMidiNoteExtent(note, { fromOffset: start - note.startBeat, duration: end - start })];
    });
}
