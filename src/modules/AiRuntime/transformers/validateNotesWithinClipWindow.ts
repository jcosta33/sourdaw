import { MIDI_NOTE_MIN_DURATION_BEATS } from '#/utils/midiNoteBatchLimits';

export type ClipContentWindow = {
    endBeat: number;
    startBeat: number;
};

function isNoteRecord(value: unknown): value is Readonly<Record<string, unknown>> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Whether every note lands inside the window of clip content that actually sounds. Note beats are
 * media coordinates, not offsets into the clip's rectangle on the timeline: the scheduler reads
 * `note.startBeat - midiOffsetBeats` and drops anything at or past the clip's loop length, so a
 * slipped or looped clip sounds a window that starts at its offset and is as long as that loop
 * length. Bounding notes by the rectangle instead would refuse every note a slipped clip plays and
 * admit notes a looped one silently discards.
 *
 * `subject` names the note in the reason, because the two routes that share this rule refuse for
 * visibly different causes and a reader of the rejection is owed which one they hit.
 */
export function validateNotesWithinClipWindow(
    notes: readonly unknown[],
    window: ClipContentWindow,
    subject: string
): string | null {
    for (const [noteIndex, note] of notes.entries()) {
        if (!isNoteRecord(note)) {
            continue;
        }
        const { startBeat, duration } = note;
        const position = `${subject} ${String(noteIndex)}`;
        const bounds = `the clip content window of beats ${String(window.startBeat)} to ${String(window.endBeat)}`;
        if (typeof startBeat !== 'number' || !Number.isFinite(startBeat) || startBeat < window.startBeat) {
            return `${position} falls outside ${bounds}`;
        }
        if (typeof duration !== 'number' || !Number.isFinite(duration) || duration < MIDI_NOTE_MIN_DURATION_BEATS) {
            return `${position} is shorter than ${String(MIDI_NOTE_MIN_DURATION_BEATS)} beats`;
        }
        if (startBeat + duration > window.endBeat) {
            return `${position} falls outside ${bounds}`;
        }
    }
    return null;
}
