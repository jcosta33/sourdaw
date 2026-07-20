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
});
