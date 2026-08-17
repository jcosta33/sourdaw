import { describe, it, expect } from 'vitest';

import { type MidiEvent, type TransportInfo } from '../../../models/MidiEvent';
import { CCGenerator } from '../CCGenerator';

const transport: TransportInfo = {
    isPlaying: true,
    ppqPosition: 0,
    bpm: 120,
    sampleRate: 44100,
    barIndex: 0,
    beatInBar: 0,
    timeSigNum: 4,
    timeSigDen: 4,
    loopEnabled: false,
    loopStartPpq: 0,
    loopEndPpq: 0,
};

describe('CCGenerator', () => {
    it('exports CCGenerator', () => {
        expect(CCGenerator).toBeDefined();
    });

    describe('setParam (fix #4: ignore unknown params like every other processor)', () => {
        it('does not throw on an unknown parameter name', () => {
            const gen = new CCGenerator('cc-test');
            expect(() => gen.setParam('does_not_exist', 1)).not.toThrow();
        });

        it('still applies known parameters', () => {
            const gen = new CCGenerator('cc-test');
            // cc_number should clamp to 0..127 and take effect on emitted CC.
            gen.setParam('cc_number', 74);
            const output: MidiEvent[] = [];
            gen.processMidi(
                [{ timeSamples: 0, kind: { type: 'noteOn', channel: 0, note: 60, velocity: 100 } }],
                output,
                transport
            );
            const cc = output.find((event) => event.kind.type === 'cc');
            expect(cc?.kind.type === 'cc' && cc.kind.cc).toBe(74);
        });
    });

    describe('processMidi (fix #4: no audio-thread throw on shape evaluation)', () => {
        it('does not throw for any clamped shape value', () => {
            const gen = new CCGenerator('cc-test');
            for (let shapeIdx = 0; shapeIdx <= 6; shapeIdx++) {
                gen.setParam('shape', shapeIdx);
                const output: MidiEvent[] = [];
                expect(() =>
                    gen.processMidi(
                        [{ timeSamples: 0, kind: { type: 'noteOn', channel: 0, note: 60, velocity: 100 } }],
                        output,
                        transport
                    )
                ).not.toThrow();
            }
        });

        it('regenerates its sample-and-hold value near a phase wrap', () => {
            const gen = new CCGenerator('cc-test');
            gen.setParam('shape', 5); // sampleHold
            const output: MidiEvent[] = [];
            gen.processMidi([], output, transport);

            const cc = output.find((event) => event.kind.type === 'cc');
            expect(cc).toBeDefined();
            expect(cc?.kind.type === 'cc' && cc.kind.value).toBeGreaterThanOrEqual(0);
            expect(cc?.kind.type === 'cc' && cc.kind.value).toBeLessThanOrEqual(127);
        });

        it('resets accumulated phase and change-detection state via reset()', () => {
            const gen = new CCGenerator('cc-test');
            gen.processMidi([], [], transport);
            gen.reset();

            // A fresh accumPhase plus lastEmittedValue back at -1 forces the very
            // first post-reset sample to register as a change and be emitted.
            const output: MidiEvent[] = [];
            gen.processMidi([], output, transport);
            expect(output.some((event) => event.kind.type === 'cc')).toBe(true);
        });

        it('retriggers accumulated phase back to zero on note-on', () => {
            const gen = new CCGenerator('cc-retrigger');
            gen.setParam('retrigger', 1);

            // Advance phase away from zero with a note-less block.
            gen.processMidi([], [], transport);
            const phaseAfterFirstBlock = (gen as unknown as { accumPhase: number }).accumPhase;
            expect(phaseAfterFirstBlock).toBeGreaterThan(0);

            // A note-on with retrigger enabled resets accumPhase to 0 *before* this
            // block's own advance runs, so the block ends no further along than a
            // single block's worth of phase -- identical to the first block's delta.
            gen.processMidi(
                [{ timeSamples: 0, kind: { type: 'noteOn', channel: 0, note: 60, velocity: 100 } }],
                [],
                transport
            );
            const phaseAfterRetrigger = (gen as unknown as { accumPhase: number }).accumPhase;
            expect(phaseAfterRetrigger).toBeCloseTo(phaseAfterFirstBlock, 10);
        });
    });

    describe('setParam / replaceParams', () => {
        it('replaceParams resets to defaults, then applies every known parameter', () => {
            const gen = new CCGenerator('cc-test');
            gen.setParam('cc_number', 99); // will be wiped by the reset

            gen.replaceParams({
                cc_number: 20,
                rate_denom: 8,
                free_rate_hz: 5,
                sync: 0, // switches to free-running Hz timing
                min: 10,
                max: 100,
                phase: 0.25,
                retrigger: 1,
            });

            const output: MidiEvent[] = [];
            gen.processMidi(
                [{ timeSamples: 0, kind: { type: 'noteOn', channel: 0, note: 60, velocity: 100 } }],
                output,
                transport
            );

            const cc = output.find((event) => event.kind.type === 'cc');
            expect(cc).toBeDefined();
            expect(cc?.kind.type === 'cc' && cc.kind.cc).toBe(20);
            expect(cc?.kind.type === 'cc' && cc.kind.value).toBeGreaterThanOrEqual(10);
            expect(cc?.kind.type === 'cc' && cc.kind.value).toBeLessThanOrEqual(100);
        });
    });

    describe('LFO shape DSP (evalShape branches)', () => {
        // A wide block window + fast free-running rate sweeps a full cycle, so the
        // emitted CC values must span the whole waveform range for each shape.
        function emittedValues(gen: CCGenerator): number[] {
            const output: MidiEvent[] = [];
            const fastTransport: TransportInfo = {
                ...transport,
                blockStartSamples: 0,
                blockEndSamples: 44100, // 1 second at 44.1kHz
            };
            gen.processMidi([], output, fastTransport);
            return output
                .filter((event) => event.kind.type === 'cc')
                .map((event) => (event.kind.type === 'cc' ? event.kind.value : -1));
        }

        it('triangle rises and then falls across a full cycle (both halves exercised)', () => {
            const gen = new CCGenerator('tri');
            gen.setParam('shape', 1); // triangle
            gen.setParam('sync', 0);
            gen.setParam('free_rate_hz', 1); // 1 cycle over the 1s block
            gen.setParam('min', 0);
            gen.setParam('max', 127);
            const values = emittedValues(gen);
            // The triangle is param*2 on the rising half then 2-param*2 on the
            // falling half. Across a full cycle the emitted sequence must climb
            // to a peak and then descend — proving both branches of the shape ran.
            // (A square wave would never descend; a sawUp would never descend.)
            const peakIndex = values.indexOf(Math.max(...values));
            expect(peakIndex).toBeGreaterThan(0);
            expect(peakIndex).toBeLessThan(values.length - 1);
            // After the peak, at least one value drops below it (the falling half).
            const afterPeak = values.slice(peakIndex + 1);
            expect(Math.min(...afterPeak)).toBeLessThan(values[peakIndex]!);
        });

        it('square emits only the two rail values 0 and 127', () => {
            const gen = new CCGenerator('sq');
            gen.setParam('shape', 2); // square
            gen.setParam('sync', 0);
            gen.setParam('free_rate_hz', 2);
            gen.setParam('min', 0);
            gen.setParam('max', 127);
            const values = emittedValues(gen);
            // Both halves of the square (param < 0.5 → 127, param >= 0.5 → 0) must
            // appear; every value is exactly one of the two rails.
            const unique = new Set(values);
            expect(unique.has(127)).toBe(true);
            expect(unique.has(0)).toBe(true);
            for (const value of values) {
                expect(value === 0 || value === 127).toBe(true);
            }
        });
    });

    describe('inverted min / max', () => {
        // Same 1-second sweep the shape specs use.
        function emittedValues(gen: CCGenerator): number[] {
            const output: MidiEvent[] = [];
            gen.processMidi([], output, { ...transport, blockStartSamples: 0, blockEndSamples: 44_100 });
            return output
                .filter((event) => event.kind.type === 'cc')
                .map((event) => (event.kind.type === 'cc' ? event.kind.value : -1));
        }

        it('reads an inverted output range as the same range instead of inverting the LFO', () => {
            // No UI reaches this pair; a stored project, a CRDT merge, or an
            // AI-authored action can. Applied in the stored order the span
            // `max - min` goes negative, so a sawUp ramps DOWN — the shape the
            // user selected plays backwards.
            const inverted = new CCGenerator('cc-inverted');
            const ordered = new CCGenerator('cc-ordered');
            for (const gen of [inverted, ordered]) {
                gen.setParam('shape', 3); // sawUp
                gen.setParam('sync', 0);
                gen.setParam('free_rate_hz', 0.5); // half a cycle — no wrap in the window
            }
            inverted.setParam('min', 100);
            inverted.setParam('max', 20);
            ordered.setParam('min', 20);
            ordered.setParam('max', 100);

            const values = emittedValues(inverted);
            expect(values).toEqual(emittedValues(ordered));
            expect(Math.min(...values)).toBeGreaterThanOrEqual(20);
            expect(Math.max(...values)).toBeLessThanOrEqual(100);
            // sawUp still ramps UP. Applied in the stored order the negative
            // span would run the same shape backwards.
            expect(values.at(-1)!).toBeGreaterThan(values[0]!);
        });
    });

    describe('LFO phase advances with the block span, not the interval count', () => {
        function runSpan(gen: CCGenerator, totalSamples: number, blockSizeSamples: number): void {
            for (let start = 0; start < totalSamples; start += blockSizeSamples) {
                gen.processMidi([], [], {
                    ...transport,
                    blockStartSamples: start,
                    blockEndSamples: Math.min(start + blockSizeSamples, totalSamples),
                });
            }
        }

        /** One 64-sample probe block — exactly one emit interval. */
        function probe(gen: CCGenerator, startSamples: number): number[] {
            const output: MidiEvent[] = [];
            gen.processMidi([], output, {
                ...transport,
                blockStartSamples: startSamples,
                blockEndSamples: startSamples + 64,
            });
            return output
                .filter((event) => event.kind.type === 'cc')
                .map((event) => (event.kind.type === 'cc' ? event.kind.value : -1));
        }

        it('lands on the same phase whether a span arrives as one block or many odd-sized ones', () => {
            // The emit loop steps in 64-sample intervals. Advancing a full
            // interval on the final partial pass runs the LFO fast in
            // proportion to how badly the block divides by 64 — a 100-sample
            // block advanced 128 samples of phase, and short sub-blocks are
            // routine (tempo-change splits), so the error compounds. Both
            // generators cover the identical 44100-sample span and must
            // therefore reach the identical phase.
            const oneBlock = new CCGenerator('phase-one');
            const oddBlocks = new CCGenerator('phase-odd');
            for (const gen of [oneBlock, oddBlocks]) {
                gen.setParam('shape', 3); // sawUp — value maps straight to phase
                gen.setParam('sync', 0);
                gen.setParam('free_rate_hz', 20); // clears the change threshold every interval
            }

            runSpan(oneBlock, 44_100, 44_100);
            runSpan(oddBlocks, 44_100, 100); // 441 blocks that do not divide by 64

            const fromOneBlock = probe(oneBlock, 44_100);
            const fromOddBlocks = probe(oddBlocks, 44_100);
            expect(fromOneBlock).not.toEqual([]); // the probe actually emitted
            expect(fromOddBlocks).toEqual(fromOneBlock);
        });
    });

    describe('transport stopped', () => {
        it('emits no CC while transport.isPlaying is false', () => {
            const gen = new CCGenerator('stopped');
            const stopped: TransportInfo = { ...transport, isPlaying: false };
            const output: MidiEvent[] = [];
            gen.processMidi(
                [{ timeSamples: 0, kind: { type: 'noteOn', channel: 0, note: 60, velocity: 100 } }],
                output,
                stopped
            );
            // Input passes through but no CC is generated while stopped.
            expect(output.some((event) => event.kind.type === 'cc')).toBe(false);
            expect(output.some((event) => event.kind.type === 'noteOn')).toBe(true);
        });
    });
});
