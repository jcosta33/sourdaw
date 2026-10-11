import { describe, expect, it } from 'vitest';

import { projectClipLoopExpansion } from '#/utils/clipLoopProjection';
import { MIDI_NOTE_MIN_DURATION_BEATS } from '#/utils/midiNoteBatchLimits';

import { buildLlmActionSystemPrompt } from '../llmActionBridge';
import { validateNotesWithinClipWindow, type ClipContentWindowInput } from '../validateNotesWithinClipWindow';

type StatedNote = { startBeat: number; duration: number };

/**
 * The note law the system prompt states, transcribed literally: this is the
 * rule a model following the prompt implements. The agreement tests hold the
 * transcription against the validator, so the prompt can never teach a window
 * the application then refuses (#5198: the pre-anchor sentence admitted notes
 * the anchored validator rejects and forbade the wrapped head it plays).
 */
function promptAdmits(note: StatedNote, clip: ClipContentWindowInput): boolean {
    const offsetBeats = clip.midiOffsetBeats ?? 0;
    const loopEnabled = clip.loopEnabled ?? false;
    const loopLengthBeats = projectClipLoopExpansion({
        clipDurationBeats: clip.endBeat - clip.startBeat,
        configuredLoopLengthBeats: clip.loopLength,
        loopEnabled,
    }).loopLengthBeats;
    // "Every note lasts at least <MIN> beats."
    if (note.duration < MIDI_NOTE_MIN_DURATION_BEATS) {
        return false;
    }
    const passSpanBeats = Math.min(loopLengthBeats, clip.endBeat - clip.startBeat);
    if (loopEnabled && clip.loopOriginBeat !== undefined) {
        // "the window opening at its midiOffsetBeats minus how far its
        // startBeat sits past its loopOriginBeat and running for its loopLength"
        const openingBeat = offsetBeats - (clip.startBeat - clip.loopOriginBeat);
        if (note.startBeat < openingBeat || note.startBeat >= openingBeat + loopLengthBeats) {
            return false;
        }
        // "its position from the window opening wrapped by the loopLength must
        // sit before the shorter of that loopLength and endBeat minus startBeat"
        const phaseBeat = (((note.startBeat - openingBeat) % loopLengthBeats) + loopLengthBeats) % loopLengthBeats;
        if (phaseBeat >= passSpanBeats) {
            return false;
        }
        // "its duration may never outlast the loopLength, and a note ringing
        // past that shorter span only fits when the span reaches the full loopLength"
        if (note.duration > loopLengthBeats) {
            return false;
        }
        return phaseBeat + note.duration <= passSpanBeats || passSpanBeats === loopLengthBeats;
    }
    // "start at or after its midiOffsetBeats and end at or before that offset
    // plus whichever is shorter of its loopLength and endBeat minus startBeat"
    const windowEndBeat = offsetBeats + Math.min(loopLengthBeats, passSpanBeats);
    return note.startBeat >= offsetBeats && note.startBeat + note.duration <= windowEndBeat;
}

/** A clip trimmed two beats into a four-beat loop it was anchored to at beat 0. */
const TRIMMED_LOOPED_CLIP: ClipContentWindowInput = {
    startBeat: 2,
    endBeat: 10,
    midiOffsetBeats: 2,
    loopEnabled: true,
    loopLength: 4,
    loopOriginBeat: 0,
};

const SWEEP_DURATIONS = [MIDI_NOTE_MIN_DURATION_BEATS, 0.5, 1, 2, 4, 5];

function sweepNotes(clipStartBeat: number, clipEndBeat: number): StatedNote[] {
    const notes: StatedNote[] = [];
    for (let startBeat = clipStartBeat; startBeat <= clipEndBeat; startBeat += 0.25) {
        for (const duration of SWEEP_DURATIONS) {
            notes.push({ startBeat, duration });
        }
    }
    return notes;
}

function expectPromptAgreesWithValidator(clip: ClipContentWindowInput): void {
    for (const note of sweepNotes(clip.startBeat, clip.endBeat)) {
        const verdict = validateNotesWithinClipWindow([note], clip, 'note');
        expect(promptAdmits(note, clip), `note ${String(note.startBeat)} + ${String(note.duration)}`).toBe(
            verdict === null
        );
    }
}

describe('the system prompt note-window law agrees with the validator', () => {
    it('states the anchored window in terms the project context reports', () => {
        const systemPrompt = buildLlmActionSystemPrompt();

        expect(systemPrompt).toContain('loopOriginBeat');
        expect(systemPrompt).toContain(
            'the window opening at its midiOffsetBeats minus how far its startBeat sits past its loopOriginBeat and running for its loopLength'
        );
        expect(systemPrompt).toContain('its position from the window opening wrapped by the loopLength');
    });

    it('agrees with the validator across a trimmed looped clip', () => {
        expectPromptAgreesWithValidator(TRIMMED_LOOPED_CLIP);
    });

    it('admits the wrapped-head note the pre-anchor sentence forbade, which the validator plays', () => {
        // Content 0.5 sits below the sliding offset (2) but inside the anchored
        // window [0, 4): the pass wraps it onto its tail, so the prompt must
        // admit it and the validator must pass it.
        const note = { startBeat: 0.5, duration: 1 };
        expect(promptAdmits(note, TRIMMED_LOOPED_CLIP)).toBe(true);
        expect(validateNotesWithinClipWindow([note], TRIMMED_LOOPED_CLIP, 'note')).toBeNull();
    });

    it('forbids the past-window note the sliding law admitted, which the validator refuses', () => {
        // Content 5.5 is a full window past the anchored ceiling (4): the exact
        // drift the old sentence taught, refused with the window it names.
        const note = { startBeat: 5.5, duration: 1 };
        expect(promptAdmits(note, TRIMMED_LOOPED_CLIP)).toBe(false);
        expect(validateNotesWithinClipWindow([note], TRIMMED_LOOPED_CLIP, 'note')).toBe(
            'note 0 falls outside the clip content window of beats 0 to 4'
        );
    });

    it('keeps the plain clip law agreeing for an unlooped clip', () => {
        expectPromptAgreesWithValidator({
            startBeat: 0,
            endBeat: 4,
            midiOffsetBeats: 1,
            loopEnabled: false,
            loopLength: undefined,
            loopOriginBeat: undefined,
        });
    });

    it('keeps the pre-anchor law agreeing for a looped clip that reports no anchor', () => {
        expectPromptAgreesWithValidator({
            startBeat: 0,
            endBeat: 8,
            midiOffsetBeats: 1,
            loopEnabled: true,
            loopLength: 4,
            loopOriginBeat: undefined,
        });
    });
});
