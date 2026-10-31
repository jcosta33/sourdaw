import { type MidiNote } from '../models/MidiNote';

/** Manual and legacy notes have no pass owner and remain in every selected take. */
export function selectMidiNotesForRecordingPass<TNote extends Pick<MidiNote, 'recordingPassIndex'>>(
    notes: readonly TNote[],
    recordingPassIndex: number | undefined
): readonly TNote[] {
    if (recordingPassIndex !== undefined && (!Number.isSafeInteger(recordingPassIndex) || recordingPassIndex < 0)) {
        throw new Error('Invalid MIDI take recording pass index');
    }
    for (const note of notes) {
        if (
            Object.hasOwn(note, 'recordingPassIndex') &&
            (!Number.isSafeInteger(note.recordingPassIndex) || (note.recordingPassIndex ?? -1) < 0)
        ) {
            throw new Error('Invalid MIDI note recording pass index');
        }
    }
    if (recordingPassIndex === undefined) {
        return notes;
    }
    return notes.filter(
        (note) => !Object.hasOwn(note, 'recordingPassIndex') || note.recordingPassIndex === recordingPassIndex
    );
}
