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
    });
});
