import {
    hasNoteExpression,
    normalizeNoteExpression,
    resolveNoteExpressionControls,
    type NoteExpressionWireValues,
} from '../../engine/noteExpression';
import { audioEngine } from '../engineAccess/getAudioContext';

type ApplyNoteExpressionInput = {
    /** Track owning the instrument — the resolved instrument track, not the source track. */
    trackId: string;
    /** MIDI note number the expression addresses. */
    note: number;
    /**
     * MPE member channel that owns the note. Together with `note` this is the
     * per-note address: the engines only touch a voice that is still held on
     * this channel, so a ringing release tail or a second member channel at the
     * same pitch is left alone. Defaults to 0, the non-MPE channel.
     */
    channel?: number;
    /** Captured expression in wire units (`pitchBend` / `pressure` / `slide`). */
    expression: NoteExpressionWireValues;
    /**
     * Absolute audio-thread frame to apply at. Omitted by the live path (apply
     * now); the scheduled path passes the note's own start frame so expression
     * lands with the note rather than at scheduling time.
     */
    sampleFrame?: number;
    /** Member-channel bend range in semitones. Defaults to the MPE member default (±48). */
    bendRangeSemitones?: number;
};

/**
 * Route MPE per-note expression to the track's instrument voices (audit MD-2).
 *
 * This is the one expression surface: live Web MIDI input and scheduled
 * playback both call it, so a note bends identically whether it is played or
 * played back. Returns `true` when an expression-capable instrument consumed
 * the values, `false` when the track has no such instrument — callers use that
 * to fall back to their own (non-per-note) handling.
 *
 * Dimensions an engine does not voice are still forwarded and dropped at the
 * engine; the editor gates those lanes per device from the same registry, so a
 * user is never offered a control the instrument cannot sound.
 */
export function applyNoteExpression({
    trackId,
    note,
    channel = 0,
    expression,
    sampleFrame,
    bendRangeSemitones,
}: ApplyNoteExpressionInput): boolean {
    if (!hasNoteExpression(expression)) {
        return false;
    }

    const strip = audioEngine.getTrackStrip(trackId);
    if (!strip) {
        return false;
    }

    const controls = resolveNoteExpressionControls(strip.deviceNodes);
    if (!controls) {
        return false;
    }

    const { bendSemitones, pressure, slide } = normalizeNoteExpression(expression, bendRangeSemitones);
    controls.noteExpression(note, channel, bendSemitones, pressure, slide, sampleFrame);
    return true;
}
