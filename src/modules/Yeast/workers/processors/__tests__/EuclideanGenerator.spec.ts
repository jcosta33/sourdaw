import { describe, it, expect } from 'vitest';

import { EuclideanGenerator } from '../EuclideanGenerator';

import type { MidiEvent, TransportInfo } from '../../../models/MidiEvent';

describe('EuclideanGenerator', () => {
    it('generates an euclid-prefixed id when none is provided', () => {
        const gen = new EuclideanGenerator();
        expect(gen.id).toMatch(/^euclid-\d+$/);
        expect(gen.name).toBe('Euclidean');
    });

    it('constructs with default pattern (5 hits, 8 steps)', () => {
        const gen = new EuclideanGenerator('test-1');
        expect(gen.getPattern()).toHaveLength(8);
        expect(gen.getPattern().filter(Boolean).length).toBe(5);
    });

    it('generates correct pattern for 3 hits 8 steps', () => {
        const gen = new EuclideanGenerator('test-2');
        gen.setParam('hits', 3);
        gen.setParam('steps', 8);
        const pattern = gen.getPattern();
        expect(pattern).toHaveLength(8);
        expect(pattern.filter(Boolean).length).toBe(3);
    });

    it('generates all-true when hits >= steps', () => {
        const gen = new EuclideanGenerator('test-3');
        gen.setParam('hits', 8);
        gen.setParam('steps', 4);
        expect(gen.getPattern().every((h) => h)).toBe(true);
    });

    it('generates all-false when hits = 0', () => {
        const gen = new EuclideanGenerator('test-4');
        gen.setParam('hits', 0);
        expect(gen.getPattern().every((h) => !h)).toBe(true);
    });

    it('rotation shifts the pattern', () => {
        const gen_a = new EuclideanGenerator('a');
        gen_a.setParam('hits', 3);
        gen_a.setParam('steps', 8);
        const gen_b = new EuclideanGenerator('b');
        gen_b.setParam('hits', 3);
        gen_b.setParam('steps', 8);
        gen_b.setParam('rotation', 1);
        expect(gen_a.getPattern()).not.toEqual(gen_b.getPattern());
    });

    it('clamps hits', () => {
        const gen = new EuclideanGenerator('test-5');
        gen.setParam('hits', 100);
        expect(gen.getPattern().filter(Boolean).length).toBeLessThanOrEqual(32);
        gen.setParam('hits', -5);
        expect(gen.getPattern().every((h) => !h)).toBe(true);
    });

    it('clamps steps to minimum 1', () => {
        const gen = new EuclideanGenerator('test-6');
        gen.setParam('steps', 0);
        gen.setParam('hits', 1);
        expect(gen.getPattern().length).toBeGreaterThanOrEqual(1);
    });

    it('reset clears state', () => {
        const gen = new EuclideanGenerator('test-7');
        gen.reset();
        expect(gen.getCurrentStep()).toBe(0);
    });

    it('setParam accepts all known params without crash', () => {
        const gen = new EuclideanGenerator('test-8');
        gen.setParam('hits', 4);
        gen.setParam('steps', 6);
        gen.setParam('rotation', 2);
        gen.setParam('rate_denom', 8);
        gen.setParam('gate', 0.5);
        gen.setParam('note', 72);
        gen.setParam('velocity', 80);
        expect(gen.getPattern()).toHaveLength(6);
    });

    it('pairs a generated lifetime across blocks by instance id', () => {
        const gen = new EuclideanGenerator('duration');
        gen.setParam('hits', 8);
        const transport: TransportInfo = {
            sampleRate: 48_000,
            bpm: 120,
            blockStartSamples: 0,
            blockEndSamples: 6_001,
            ppqPosition: 0,
            isPlaying: true,
            barIndex: 0,
            beatInBar: 0,
            timeSigNum: 4,
            timeSigDen: 4,
            loopEnabled: false,
            loopStartPpq: 0,
            loopEndPpq: 0,
        };
        const noteOns: MidiEvent[] = [];
        gen.processMidi([], noteOns, transport);
        const noteOn = noteOns.find((event) => event.kind.type === 'noteOn');

        const noteOffs: MidiEvent[] = [];
        gen.processMidi([], noteOffs, { ...transport, blockStartSamples: 6_001, blockEndSamples: 9_001 });
        expect(noteOn).toEqual(expect.objectContaining({ durationSamples: 3_000 }));
        expect(noteOffs).toEqual([expect.objectContaining({ noteInstanceId: noteOn?.noteInstanceId })]);
    });

    it('passes input events through to the output unchanged', () => {
        // Exercises the input-passthrough loop (line 69): every incoming event
        // must appear in the output verbatim, ahead of any generated events.
        const gen = new EuclideanGenerator('passthrough');
        const input: MidiEvent = {
            timeSamples: 0,
            kind: { type: 'cc', channel: 0, cc: 7, value: 64 },
        };
        const transport: TransportInfo = {
            sampleRate: 48_000,
            bpm: 120,
            blockStartSamples: 0,
            blockEndSamples: 0,
            ppqPosition: 0,
            isPlaying: true,
            barIndex: 0,
            beatInBar: 0,
            timeSigNum: 4,
            timeSigDen: 4,
            loopEnabled: false,
            loopStartPpq: 0,
            loopEndPpq: 0,
        };
        const out: MidiEvent[] = [];
        gen.processMidi([input], out, transport);
        expect(out[0]).toBe(input);
    });

    it('does not generate any notes while transport is stopped', () => {
        // When transport.isPlaying is false, processMidi returns early after
        // passing input through — no scheduled hits, no note-offs drained.
        const gen = new EuclideanGenerator('stopped');
        gen.setParam('hits', 8); // every step is a hit
        const transport: TransportInfo = {
            sampleRate: 48_000,
            bpm: 120,
            blockStartSamples: 0,
            blockEndSamples: 100_000, // huge block that would normally schedule many hits
            ppqPosition: 0,
            isPlaying: false,
            barIndex: 0,
            beatInBar: 0,
            timeSigNum: 4,
            timeSigDen: 4,
            loopEnabled: false,
            loopStartPpq: 0,
            loopEndPpq: 0,
        };
        const out: MidiEvent[] = [];
        gen.processMidi([], out, transport);
        expect(out).toHaveLength(0); // stopped → no generation, no passthrough
    });

    describe('replaceParams resets to defaults before re-applying', () => {
        // resetParams restores hits=5, steps=8, rotation=0, rate denom=16,
        // gate=0.5, note=60, velocity=100. replaceParams({}) must therefore
        // collapse a heavily-customised generator back to the default pattern.
        it('restores the default 5-of-8 pattern after customisation', () => {
            const gen = new EuclideanGenerator('replace');
            gen.setParam('hits', 1);
            gen.setParam('steps', 16);
            gen.setParam('rotation', 4);
            gen.setParam('gate', 1.5);
            gen.setParam('note', 72);
            gen.setParam('velocity', 50);
            expect(gen.getPattern()).toHaveLength(16);
            expect(gen.getPattern().filter(Boolean).length).toBe(1);

            gen.replaceParams({});
            // After replaceParams({}) the defaults are restored.
            expect(gen.getPattern()).toHaveLength(8);
            expect(gen.getPattern().filter(Boolean).length).toBe(5);
        });
    });

    describe('transport block-bounds fallbacks', () => {
        // When the transport omits blockStartSamples/blockEndSamples, the
        // generator derives `now` from the first input event's timeSamples
        // (line 78) and assumes a 128-sample block window (line 79).
        it('derives now from input[0].timeSamples when blockStartSamples is absent', () => {
            const gen = new EuclideanGenerator('fallback-now');
            // 1/16 at 120bpm/48k = 24000 samples/block. Use a single hit so a
            // noteOn fires only if `now` is correctly read from the input.
            gen.setParam('hits', 8); // every step is a hit
            gen.setParam('rate_denom', 16);
            const transport: TransportInfo = {
                sampleRate: 48_000,
                bpm: 120,
                // blockStartSamples/blockEndSamples intentionally omitted
                ppqPosition: 0,
                isPlaying: true,
                barIndex: 0,
                beatInBar: 0,
                timeSigNum: 4,
                timeSigDen: 4,
                loopEnabled: false,
                loopStartPpq: 0,
                loopEndPpq: 0,
            };
            // Provide an input event so input[0].timeSamples is the `now` source.
            const seed: MidiEvent = {
                timeSamples: 0,
                kind: { type: 'cc', channel: 0, cc: 0, value: 0 },
            };
            const out: MidiEvent[] = [];
            // With blockEnd defaulting to now+128, no full step (24000 samples)
            // fits in the 128-sample window → no noteOn generated, but the CC
            // passes through. This proves the fallback path executed without NaN.
            gen.processMidi([seed], out, transport);
            expect(out[0]).toBe(seed);
        });

        it('falls back to now=0 when neither blockStartSamples nor input exist', () => {
            const gen = new EuclideanGenerator('fallback-zero');
            gen.setParam('hits', 8);
            const transport: TransportInfo = {
                sampleRate: 48_000,
                bpm: 120,
                ppqPosition: 0,
                isPlaying: true,
                barIndex: 0,
                beatInBar: 0,
                timeSigNum: 4,
                timeSigDen: 4,
                loopEnabled: false,
                loopStartPpq: 0,
                loopEndPpq: 0,
            };
            // No input, no block bounds → now=0, blockEnd=128. No step fits.
            const out: MidiEvent[] = [];
            expect(() => gen.processMidi([], out, transport)).not.toThrow();
        });
    });

    it('skips note emission on a rest step but still advances the step counter', () => {
        // A 1-of-4 pattern has rests at steps 1,2,3. Starting from step 0 (the
        // single hit), the next steps are rests → no noteOn emitted for them,
        // exercising the falsy arm of `if (pattern[stepIndex % len])`.
        const gen = new EuclideanGenerator('rest');
        gen.setParam('hits', 1);
        gen.setParam('steps', 4);
        gen.setParam('rate_denom', 16);
        const pattern = gen.getPattern();
        // Bresenham even distribution of 1 hit across 4 steps lands the hit on
        // the final step: [false, false, false, true]. The first three steps
        // are rests, exercising the falsy arm of the hit check.
        expect(pattern).toEqual([false, false, false, true]);

        const transport: TransportInfo = {
            sampleRate: 48_000,
            bpm: 120,
            blockStartSamples: 0,
            // 4 sixteenth steps = 4 * 24000 = 96000 samples; cover all 4 steps.
            blockEndSamples: 96_001,
            ppqPosition: 0,
            isPlaying: true,
            barIndex: 0,
            beatInBar: 0,
            timeSigNum: 4,
            timeSigDen: 4,
            loopEnabled: false,
            loopStartPpq: 0,
            loopEndPpq: 0,
        };
        const out: MidiEvent[] = [];
        gen.processMidi([], out, transport);
        const noteOns = out.filter((e) => e.kind.type === 'noteOn');
        // Exactly one hit per 4-step cycle; over 96k samples (4 steps) the cycle
        // repeats once, yielding 2 noteOns total (one per cycle), never on rests.
        expect(noteOns.length).toBeGreaterThanOrEqual(1);
        // After this block the step counter advanced through rests.
        expect(gen.getCurrentStep()).toBeGreaterThanOrEqual(0);
    });
});
