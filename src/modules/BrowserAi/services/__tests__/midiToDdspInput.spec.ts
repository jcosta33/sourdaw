import { describe, it, expect } from 'vitest';

import { midiToHz, velocityToDb } from '../audioResampler';
import { midiToDdspInput, type MidiNote } from '../midiToDdspInput';

describe('midiToDdspInput', () => {
    function note(overrides: Partial<MidiNote> = {}): MidiNote {
        return {
            pitch: 69,
            velocity: 100,
            startSec: 0,
            durationSec: 1,
            ...overrides,
        };
    }

    it('writes the note pitch across its active frames and silence elsewhere', () => {
        const { pitchHz, loudnessDb, nFrames } = midiToDdspInput({
            notes: [note({ startSec: 0, durationSec: 0.4 })],
            durationSec: 1,
            frameRate: 250,
        });

        expect(nFrames).toBe(250);
        // A frame well inside the note carries the note's pitch.
        expect(pitchHz[50]).toBeCloseTo(midiToHz(69), 5);
        // A frame after the note ends is silent.
        expect(pitchHz[200]).toBe(0);
        expect(loudnessDb[200]).toBe(-120);
    });

    // Regression: a note shorter than attack+release used to be mangled. With
    // attack 0.01s (3 frames) and release 0.05s (13 frames) on a 5-frame note,
    // the release term (releaseFrames > noteLength) dominated the tail with a far
    // too-steep slope, so the envelope ramped to 0.667 at frame 2 then *collapsed*
    // to 0.154 at frame 3 — a discontinuous downward jump mid-note. The fix clamps
    // each ramp to noteLength/2 so the envelope is a clean unimodal rise-then-fall
    // with no jump larger than a single clamped step.
    it('keeps a continuous unimodal envelope on a note shorter than attack+release', () => {
        const frameRate = 250;
        const { loudnessDb } = midiToDdspInput({
            notes: [note({ velocity: 127, startSec: 0, durationSec: 0.02 })],
            durationSec: 1,
            frameRate,
            attackSec: 0.01,
            releaseSec: 0.05,
        });

        const noteLength = Math.ceil(0.02 * frameRate); // 5 frames
        expect(noteLength).toBe(5);

        // Reconstruct linear gains from loudness (targetDb = 0 dB at velocity 127).
        const gains = Array.from(loudnessDb.subarray(0, noteLength)).map((db) => (db <= -120 ? 0 : 10 ** (db / 20)));

        // The envelope must ramp UP at the start.
        expect(gains[0]!).toBeLessThan(gains[1]!);

        // Unimodal: strictly find the peak, then assert non-increasing after it and
        // non-decreasing before it — the old envelope's 0.667 -> 0.154 collapse
        // violated this (it rose, fell to 0.154, with the fall starting before the
        // true peak under the clamped shape).
        const peakIndex = gains.indexOf(Math.max(...gains));
        for (let i = 1; i <= peakIndex; i++) {
            expect(gains[i]!).toBeGreaterThanOrEqual(gains[i - 1]!);
        }
        for (let i = peakIndex + 1; i < gains.length; i++) {
            expect(gains[i]!).toBeLessThanOrEqual(gains[i - 1]!);
        }

        // No single-frame jump may exceed the largest clamped ramp step. With both
        // ramps clamped to noteLength/2 = 2.5 frames, the steepest legitimate step
        // is 1 / floor-ish(2.5); the old collapse jumped by ~0.5 which fails this.
        const maxStep = 1 / Math.floor(noteLength / 2);
        for (let i = 1; i < gains.length; i++) {
            expect(Math.abs(gains[i]! - gains[i - 1]!)).toBeLessThanOrEqual(maxStep + 1e-6);
        }
    });

    // Regression: effective attack/release are each clamped to noteLength/2 so
    // the two ramps never overlap into a negative pre-clamp gain.
    it('produces a monotone-up-then-down envelope on a short note (no negative gain artifacts)', () => {
        const frameRate = 250;
        const { loudnessDb } = midiToDdspInput({
            notes: [note({ velocity: 127, startSec: 0, durationSec: 0.04 })],
            durationSec: 1,
            frameRate,
            attackSec: 0.02,
            releaseSec: 0.02,
        });

        const noteLength = Math.ceil(0.04 * frameRate); // 10 frames
        const db = Array.from(loudnessDb.subarray(0, noteLength));

        // Every loudness value must be a real dB (never NaN from log10 of a
        // negative gain) and at most the velocity target (0 dB at velocity 127).
        const targetDb = velocityToDb(127);
        for (const value of db) {
            expect(Number.isNaN(value)).toBe(false);
            expect(value).toBeLessThanOrEqual(targetDb + 1e-6);
        }

        // The loudest frame is somewhere in the interior (attack rose to a peak,
        // release falls from it) — not at frame 0.
        const peakIndex = db.indexOf(Math.max(...db));
        expect(peakIndex).toBeGreaterThan(0);
    });
});

describe('midiToDdspInput — monophonic input contract (issue #3789)', () => {
    const chord = (order: Array<number>): MidiNote[] =>
        order.map((pitch) => ({ pitch, velocity: 100, startSec: 0, durationSec: 1 }));

    it('refuses a simultaneous chord instead of rendering an arbitrary surviving voice', () => {
        expect(() => midiToDdspInput({ notes: chord([60, 64, 67]), durationSec: 1 })).toThrow(
            /polyphonic.*C4 and E4.*monophonic/u
        );
    });

    it('names the same overlap regardless of the notes input order', () => {
        let forward: string | null = null;
        let reverse: string | null = null;
        try {
            midiToDdspInput({ notes: chord([60, 64, 67]), durationSec: 1 });
        } catch (error) {
            forward = (error as Error).message;
        }
        try {
            midiToDdspInput({ notes: chord([67, 64, 60]), durationSec: 1 });
        } catch (error) {
            reverse = (error as Error).message;
        }
        expect(forward).toBe(reverse);
    });

    it('refuses partial overlaps and overlapping repeated pitches', () => {
        const partial = [
            { pitch: 69, velocity: 100, startSec: 0, durationSec: 0.5 },
            { pitch: 71, velocity: 100, startSec: 0.4, durationSec: 0.5 },
        ];
        expect(() => midiToDdspInput({ notes: partial, durationSec: 1 })).toThrow(/polyphonic/u);

        const repeated = [
            { pitch: 60, velocity: 100, startSec: 0, durationSec: 0.5 },
            { pitch: 60, velocity: 100, startSec: 0.25, durationSec: 0.5 },
        ];
        expect(() => midiToDdspInput({ notes: repeated, durationSec: 1 })).toThrow(/polyphonic/u);
    });

    it('renders a nonoverlapping monophonic phrase with its timing and pitch intact', () => {
        const phrase: MidiNote[] = [
            { pitch: 60, velocity: 100, startSec: 0, durationSec: 0.5 },
            { pitch: 62, velocity: 100, startSec: 0.5, durationSec: 0.25 },
            { pitch: 64, velocity: 100, startSec: 0.875, durationSec: 0.125 },
        ];
        const { pitchHz, nFrames } = midiToDdspInput({ notes: phrase, durationSec: 1 });

        // pitchHz is a Float32Array, so compare at float32 precision.
        expect(pitchHz[10]).toBeCloseTo(midiToHz(60), 3);
        expect(pitchHz[150]).toBeCloseTo(midiToHz(62), 3);
        expect(pitchHz[230]).toBeCloseTo(midiToHz(64), 3);
        // The 0.75–0.875s gap between notes 2 and 3 stays silent.
        expect(pitchHz[200]).toBe(0);
        expect(nFrames).toBe(250);
    });

    it('renders an empty clip as silence and tolerates sub-microsecond float adjacency', () => {
        const silence = midiToDdspInput({ notes: [], durationSec: 1 });
        expect(silence.pitchHz.every((value) => value === 0)).toBe(true);
        expect(silence.loudnessDb.every((value) => value === -120)).toBe(true);

        // 0.1 + 0.2 lands adjacent to 0.3 with float dust; a real phrase must
        // not be refused for sub-microsecond overlap.
        const floatAdjacent: MidiNote[] = [
            { pitch: 60, velocity: 100, startSec: 0, durationSec: 0.1 + 0.2 },
            { pitch: 62, velocity: 100, startSec: 0.3, durationSec: 0.5 },
        ];
        expect(() => midiToDdspInput({ notes: floatAdjacent, durationSec: 1 })).not.toThrow();
    });
});
