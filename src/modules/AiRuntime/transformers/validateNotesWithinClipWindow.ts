import { MIDI_NOTE_MIN_DURATION_BEATS } from '#/utils/midiNoteBatchLimits';

export type ClipContentWindow = {
    endBeat: number;
    startBeat: number;
    /**
     * The wrapped region head a start-trimmed loop plays below the phase
     * segment, in the same media coordinates (#5198). The sounding set of a
     * trimmed looped clip is a union, not a range; absent, the window is the
     * single segment it always was.
     */
    wrappedStartBeat?: number;
    wrappedEndBeat?: number;
};

function isNoteRecord(value: unknown): value is Readonly<Record<string, unknown>> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Whether every note lands inside the window of clip content that actually sounds. Note beats are
 * media coordinates, not offsets into the clip's rectangle on the timeline: the scheduler reads
 * `note.startBeat - midiOffsetBeats` against the anchored loop window plus each pass's span, so a
 * slipped or looped clip sounds a window that starts at its offset and is as long as that loop
 * length. Bounding notes by the rectangle instead would refuse every note a slipped clip plays and
 * admit notes a looped one silently discards.
 *
 * A start-trimmed looped clip sounds two segments — the pass's phase segment and, below it, the
 * wrapped region head — so a note may enter at either floor and end at either ceiling; a window
 * without wrapped bounds admits exactly the single range it always did.
 *
 * `subject` names the note in the reason, because the two routes that share this rule refuse for
 * visibly different causes and a reader of the rejection is owed which one they hit.
 */
export function validateNotesWithinClipWindow(
    notes: readonly unknown[],
    window: ClipContentWindow,
    subject: string
): string | null {
    const bounds = `the clip content window of beats ${String(window.startBeat)} to ${String(window.endBeat)}`;
    for (const [noteIndex, note] of notes.entries()) {
        if (!isNoteRecord(note)) {
            continue;
        }
        const { startBeat, duration } = note;
        const position = `${subject} ${String(noteIndex)}`;
        if (typeof startBeat !== 'number' || !Number.isFinite(startBeat) || !startsInWindow(startBeat, window)) {
            return `${position} falls outside ${bounds}`;
        }
        if (typeof duration !== 'number' || !Number.isFinite(duration) || duration < MIDI_NOTE_MIN_DURATION_BEATS) {
            return `${position} is shorter than ${String(MIDI_NOTE_MIN_DURATION_BEATS)} beats`;
        }
        if (!endsInWindow(startBeat + duration, window)) {
            return `${position} falls outside ${bounds}`;
        }
    }
    return null;
}

function startsInWindow(startBeat: number, window: ClipContentWindow): boolean {
    if (startBeat >= window.startBeat) {
        return true;
    }
    return isWrappedBound(window.wrappedStartBeat) && startBeat >= window.wrappedStartBeat;
}

function endsInWindow(endBeat: number, window: ClipContentWindow): boolean {
    if (endBeat <= window.endBeat) {
        return true;
    }
    return isWrappedBound(window.wrappedEndBeat) && endBeat <= window.wrappedEndBeat;
}

function isWrappedBound(value: number | undefined): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}
