import { isBeatInClipLoopWindow } from '#/utils/clipLoopOrigin';
import { projectClipLoopExpansion } from '#/utils/clipLoopProjection';
import { MIDI_NOTE_MIN_DURATION_BEATS } from '#/utils/midiNoteBatchLimits';

/**
 * The clip fields the note-window law reads. The anchored law measures the
 * note against the same loop quantities the schedulers pass — the timeline
 * placement whose span bounds each pass, the offset the relative coordinate
 * subtracts, and the configured loop length and anchor (#5198).
 */
export type ClipContentWindowInput = Readonly<{
    startBeat: number;
    endBeat: number;
    midiOffsetBeats: number | undefined;
    loopEnabled: boolean | undefined;
    loopLength: number | undefined;
    loopOriginBeat: number | undefined;
}>;

type ClipContentWindow = {
    endBeat: number;
    startBeat: number;
};

function isNoteRecord(value: unknown): value is Readonly<Record<string, unknown>> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The loop-phase view `selectMidiNotesForLoopWindow` indexes and the projection wraps by. */
function positiveModulo(value: number, divisor: number): number {
    return ((value % divisor) + divisor) % divisor;
}

/**
 * Whether every note lands inside the window of clip content that actually sounds. Note beats are
 * media coordinates, not offsets into the clip's rectangle on the timeline: the scheduler reads
 * `note.startBeat - midiOffsetBeats` against the anchored loop window plus each pass's span, so a
 * slipped or looped clip sounds a window that starts at its offset and is as long as that loop
 * length. Bounding notes by the rectangle instead would refuse every note a slipped clip plays and
 * admit notes a looped one silently discards.
 *
 * An anchored looped clip is validated note-wise through the same two-part law the schedulers
 * enforce, so every advance sign and span combination agrees with them by construction (#5198):
 * the note's relative start must sit inside the anchored half-open window
 * `[−advance, loopLength − advance)` (`isBeatInClipLoopWindow`, the same predicate the live index
 * and the projection test), and its loop phase must fall inside the pass's audible span
 * `min(loopLength, visualSpan)` — the phase segment pass zero sounds. The note must also sound as
 * written: the projection caps a note at the loop length and clips it at the pass span, so a
 * longer note or a phase segment that runs past the span would be truncated, and a wrapped tail
 * only exists for a span that runs the pass's full loop.
 *
 * An inert anchor — the loop off, or no anchor at all — keeps the pre-anchor law byte-identical:
 * the single window `[offset, offset + min(loopLength, span))` it always was.
 *
 * `subject` names the note in the reason, because the two routes that share this rule refuse for
 * visibly different causes and a reader of the rejection is owed which one they hit.
 */
export function validateNotesWithinClipWindow(
    notes: readonly unknown[],
    clip: ClipContentWindowInput,
    subject: string
): string | null {
    const loopEnabled = clip.loopEnabled ?? false;
    const loopLengthBeats = projectClipLoopExpansion({
        clipDurationBeats: clip.endBeat - clip.startBeat,
        configuredLoopLengthBeats: clip.loopLength,
        loopEnabled,
    }).loopLengthBeats;
    if (loopEnabled !== true || clip.loopOriginBeat === undefined) {
        return validateNotesWithinSegmentWindow(
            notes,
            {
                endBeat: (clip.midiOffsetBeats ?? 0) + Math.min(clip.endBeat - clip.startBeat, loopLengthBeats),
                startBeat: clip.midiOffsetBeats ?? 0,
            },
            subject
        );
    }
    return validateNotesWithinAnchoredLoop(notes, clip, clip.loopOriginBeat, loopLengthBeats, subject);
}

function validateNotesWithinAnchoredLoop(
    notes: readonly unknown[],
    clip: ClipContentWindowInput,
    loopOriginBeat: number,
    loopLengthBeats: number,
    subject: string
): string | null {
    const offsetBeats = clip.midiOffsetBeats ?? 0;
    const advanceBeats = clip.startBeat - loopOriginBeat;
    const windowFloorBeat = -advanceBeats;
    const windowCeilingBeat = loopLengthBeats - advanceBeats;
    // The pass-span bound: pass zero enters at the advance's phase and sounds
    // the first `min(loopLength, span)` beats of the loop — the widest pass
    // the clip ever sounds, so a note audible anywhere is audible here.
    const audibleSpanBeats = Math.min(loopLengthBeats, clip.endBeat - clip.startBeat);
    const bounds = `the clip content window of beats ${String(offsetBeats + windowFloorBeat)} to ${String(
        offsetBeats + windowCeilingBeat
    )}`;
    for (const [noteIndex, note] of notes.entries()) {
        if (!isNoteRecord(note)) {
            continue;
        }
        const { startBeat, duration } = note;
        const position = `${subject} ${String(noteIndex)}`;
        if (typeof startBeat !== 'number' || !Number.isFinite(startBeat)) {
            return `${position} falls outside ${bounds}`;
        }
        const relativeStartBeat = startBeat - offsetBeats;
        if (
            !isBeatInClipLoopWindow({
                relativeBeat: relativeStartBeat,
                startBeat: clip.startBeat,
                loopOriginBeat,
                loopLengthBeats,
                loopEnabled: true,
            })
        ) {
            return `${position} falls outside ${bounds}`;
        }
        if (typeof duration !== 'number' || !Number.isFinite(duration) || duration < MIDI_NOTE_MIN_DURATION_BEATS) {
            return `${position} is shorter than ${String(MIDI_NOTE_MIN_DURATION_BEATS)} beats`;
        }
        if (!soundsUntruncated(relativeStartBeat, duration, loopLengthBeats, audibleSpanBeats)) {
            return `${position} falls outside ${bounds}`;
        }
    }
    return null;
}

/**
 * Whether the projection plays the note exactly as written in its pass: the
 * note starts inside the pass's audible span, survives the loop-length cap
 * the wrap applies, and either fits the span outright or wraps a tail into a
 * pass head that a full-length span is there to hear.
 */
function soundsUntruncated(
    relativeStartBeat: number,
    durationBeats: number,
    loopLengthBeats: number,
    audibleSpanBeats: number
): boolean {
    const phaseBeat = positiveModulo(relativeStartBeat, loopLengthBeats);
    if (phaseBeat >= audibleSpanBeats) {
        return false;
    }
    if (durationBeats > loopLengthBeats) {
        return false;
    }
    const phaseEndBeat = phaseBeat + durationBeats;
    if (phaseEndBeat <= loopLengthBeats) {
        return phaseEndBeat <= audibleSpanBeats;
    }
    return audibleSpanBeats === loopLengthBeats;
}

function validateNotesWithinSegmentWindow(
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
    return startBeat >= window.startBeat;
}

function endsInWindow(endBeat: number, window: ClipContentWindow): boolean {
    return endBeat <= window.endBeat;
}
