import { describe, expect, it } from 'vitest';

import { projectClipLoopExpansion } from '#/utils/clipLoopProjection';
import { MIDI_NOTE_MIN_DURATION_BEATS } from '#/utils/midiNoteBatchLimits';

import { buildLlmActionSystemPrompt } from '../llmActionBridge';
import { validateNotesWithinClipWindow, type ClipContentWindowInput } from '../validateNotesWithinClipWindow';

type StatedNote = { startBeat: number; duration: number };

/**
 * The note law the system prompt states, transcribed literally: this is the
 * rule a model following the prompt implements. The paragraph pin below holds
 * the prompt to this exact text, so no clause can be added, removed, or
 * reworded into it (#5198 review: a contradicting clause appended to the
 * prompt sentence passed the sentence pins while the validator played notes
 * it forbade). The agreement tests then hold the transcription against the
 * validator, so the prompt can never teach a window the application then
 * refuses (#5198: the pre-anchor sentence admitted notes the anchored
 * validator rejects and forbade the wrapped head it plays).
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
        // "its position from its midiOffsetBeats wrapped by the loopLength must
        // sit before the shorter of that loopLength and endBeat minus startBeat"
        const phaseBeat = (((note.startBeat - offsetBeats) % loopLengthBeats) + loopLengthBeats) % loopLengthBeats;
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

/**
 * The prompt's full normative note-window paragraph, verbatim — from its
 * opening sentence through the minimum-duration sentence that closes the
 * template line it lives on. The minimum duration rides the imported constant
 * so this pin tracks the same figure the prompt interpolates.
 */
const NOTE_WINDOW_PARAGRAPH = `Note beats are positions inside a clip's own content, never timeline beats: a note in a clip you create must start at beat 0 or later and end at or before that clip's length in beats, and a note you add to an existing clip must start at or after its midiOffsetBeats and end at or before that offset plus whichever is shorter of its loopLength and endBeat minus startBeat, which is endBeat minus startBeat when it does not loop or reports no loopLength; an anchored clip, one that loops and reports a loopOriginBeat, instead sounds the window opening at its midiOffsetBeats minus how far its startBeat sits past its loopOriginBeat and running for its loopLength, so the note must start inside that window, its position from its midiOffsetBeats wrapped by the loopLength must sit before the shorter of that loopLength and endBeat minus startBeat, its duration may never outlast the loopLength, and a note ringing past that shorter span only fits when the span reaches the full loopLength, all of which the project context reports. Every note lasts at least ${MIDI_NOTE_MIN_DURATION_BEATS} beats.`;

/** The template line the note-window paragraph closes. */
function promptNoteLawLine(systemPrompt: string): string | undefined {
    return systemPrompt
        .split('\n')
        .find((line) => line.includes("Note beats are positions inside a clip's own content"));
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

/**
 * An anchored clip whose span stops short of its loop: the window runs [0, 8)
 * but each pass sounds only its first three beats, so the window-opening phase
 * basis and the validator's offset basis disagree inside the same clip (#5198
 * review: the old clause forbade the pass's own opening note and admitted the
 * silent wrapped head).
 */
const SPAN_BELOW_LOOP_ANCHORED_CLIP: ClipContentWindowInput = {
    startBeat: 5,
    endBeat: 8,
    midiOffsetBeats: 5,
    loopEnabled: true,
    loopLength: 8,
    loopOriginBeat: 0,
};

/**
 * The negative-advance anchored populations midiStrategy.spec.ts exercises: a
 * clip extended left of its anchor (advance -2), and one extended a whole loop
 * left (advance -4, its window lifted a full loop above the head). Both spans
 * reach the full loop, so the two phase bases coincide on them — the sweep
 * holds the agreement across the advance signs, not the divergence.
 */
const NEGATIVE_ADVANCE_ANCHORED_CLIP: ClipContentWindowInput = {
    startBeat: 2,
    endBeat: 7,
    midiOffsetBeats: 2,
    loopEnabled: true,
    loopLength: 4,
    loopOriginBeat: 4,
};

const WHOLE_LOOP_LIFTED_ANCHORED_CLIP: ClipContentWindowInput = {
    startBeat: 0,
    endBeat: 7,
    midiOffsetBeats: 0,
    loopEnabled: true,
    loopLength: 4,
    loopOriginBeat: 4,
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
    // An anchored clip admits notes across its whole anchored window, not only
    // the timeline rectangle: sweep the union of both so the first clause's
    // window and the rectangle's outside are both populated.
    const loopLengthBeats = projectClipLoopExpansion({
        clipDurationBeats: clip.endBeat - clip.startBeat,
        configuredLoopLengthBeats: clip.loopLength,
        loopEnabled: clip.loopEnabled ?? false,
    }).loopLengthBeats;
    let windowOpeningBeat = clip.startBeat;
    if (clip.loopEnabled === true && clip.loopOriginBeat !== undefined) {
        windowOpeningBeat = (clip.midiOffsetBeats ?? 0) - (clip.startBeat - clip.loopOriginBeat);
    }
    const sweepStartBeat = Math.min(clip.startBeat, windowOpeningBeat);
    const sweepEndBeat = Math.max(clip.endBeat, windowOpeningBeat + loopLengthBeats);
    for (const note of sweepNotes(sweepStartBeat, sweepEndBeat)) {
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
        expect(systemPrompt).toContain('its position from its midiOffsetBeats wrapped by the loopLength');
    });

    it('pins the note-window paragraph verbatim, so no clause can be added, removed, or reworded into it', () => {
        // The sentence pins above admit an appended clause, and the agreement
        // sweeps test the local transcription, not the prompt: only exact
        // equality with the live paragraph fails a contradicting addition.
        // The paragraph closes its template line, so suffix equality also
        // catches anything appended after the last sentence.
        const lawLine = promptNoteLawLine(buildLlmActionSystemPrompt());

        expect(lawLine).toBeDefined();
        expect(lawLine?.endsWith(NOTE_WINDOW_PARAGRAPH)).toBe(true);
    });

    it('agrees with the validator across a trimmed looped clip', () => {
        expectPromptAgreesWithValidator(TRIMMED_LOOPED_CLIP);
    });

    it('agrees with the validator across an anchored clip whose span stops below its loop', () => {
        expectPromptAgreesWithValidator(SPAN_BELOW_LOOP_ANCHORED_CLIP);
    });

    it('agrees with the validator across negatively advanced anchored clips', () => {
        expectPromptAgreesWithValidator(NEGATIVE_ADVANCE_ANCHORED_CLIP);
        expectPromptAgreesWithValidator(WHOLE_LOOP_LIFTED_ANCHORED_CLIP);
    });

    it('admits the pass-opening note and refuses the silent wrapped head on the span-below-loop clip', () => {
        // Start 5, offset 5, anchor 0: the anchored window is [0, 8) but each
        // pass sounds only its first 3 beats. Media 5 sits at phase 0 from the
        // offset — the validator plays it; the old window-opening basis read 5
        // and forbade it. Media 1 sits inside the window but at phase 4 from
        // the offset — silently wrapped past the span, so the validator
        // refuses it; the old basis read 1 and admitted it.
        const openingNote = { startBeat: 5, duration: 1 };
        expect(promptAdmits(openingNote, SPAN_BELOW_LOOP_ANCHORED_CLIP)).toBe(true);
        expect(validateNotesWithinClipWindow([openingNote], SPAN_BELOW_LOOP_ANCHORED_CLIP, 'note')).toBeNull();

        const wrappedHeadNote = { startBeat: 1, duration: 1 };
        expect(promptAdmits(wrappedHeadNote, SPAN_BELOW_LOOP_ANCHORED_CLIP)).toBe(false);
        expect(validateNotesWithinClipWindow([wrappedHeadNote], SPAN_BELOW_LOOP_ANCHORED_CLIP, 'note')).toBe(
            'note 0 falls outside the clip content window of beats 0 to 8'
        );
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
