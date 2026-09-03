import { MIDI_NOTE_MIN_DURATION_BEATS } from '#/utils/midiNoteBatchLimits';

function isNoteRecord(value: unknown): value is Readonly<Record<string, unknown>> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Whether every note lands inside the clip it is written into. Note beats are clip-relative, so the
 * clip's own span is the only thing that bounds where they may fall: a start beat far past the end
 * of the clip is finite, non-negative, and otherwise indistinguishable from a well-formed note, and
 * nothing else in the schema or the registry rules refuses it.
 *
 * `subject` names the note in the reason, because the two routes that share this rule refuse for
 * visibly different causes and a reader of the rejection is owed which one they hit.
 */
export function validateNotesWithinClipSpan(
    notes: readonly unknown[],
    spanBeats: number,
    subject: string
): string | null {
    for (const [noteIndex, note] of notes.entries()) {
        if (!isNoteRecord(note)) {
            continue;
        }
        const { startBeat, duration } = note;
        const position = `${subject} ${String(noteIndex)} of a clip spanning ${String(spanBeats)} beats`;
        if (typeof startBeat !== 'number' || !Number.isFinite(startBeat) || startBeat < 0) {
            return `${position} starts outside the clip`;
        }
        if (typeof duration !== 'number' || !Number.isFinite(duration) || duration < MIDI_NOTE_MIN_DURATION_BEATS) {
            return `${position} is shorter than ${String(MIDI_NOTE_MIN_DURATION_BEATS)} beats`;
        }
        if (startBeat + duration > spanBeats) {
            return `${position} ends past the clip`;
        }
    }
    return null;
}
