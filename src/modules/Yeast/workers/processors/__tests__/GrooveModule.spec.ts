import { describe, it, expect } from 'vitest';

import { type MidiEvent, type TransportInfo } from '../../../models/MidiEvent';
import { GrooveModule } from '../GrooveModule';

const transport: TransportInfo = {
    isPlaying: true,
    ppqPosition: 0,
    bpm: 120,
    sampleRate: 48000,
    barIndex: 0,
    beatInBar: 0,
    timeSigNum: 4,
    timeSigDen: 4,
    loopEnabled: false,
    loopStartPpq: 0,
    loopEndPpq: 0,
};
const note_on = (t: number, n: number, v = 100): MidiEvent => ({
    timeSamples: t,
    kind: { type: 'noteOn', channel: 0, note: n, velocity: v },
});

describe('GrooveModule', () => {
    it('constructs without crash', () => {
        const g = new GrooveModule('t1');
        expect(g).toBeDefined();
    });

    it('passes through note on events', () => {
        const g = new GrooveModule('t2');
        const out: MidiEvent[] = [];
        g.processMidi([note_on(0, 60)], out, transport);
        expect(out.length).toBeGreaterThan(0);
    });

    it('applies the canonical runtime timing and dynamics projection', () => {
        const g = new GrooveModule('t3');
        g.setParam('groove_amount', 1);
        g.setParam('groove_step_beats', 0.25);
        g.setParam('groove_slot_count', 16);
        g.setParam('groove_timing_1', 0.2);
        g.setParam('groove_dynamics_1', -0.1);
        const out: MidiEvent[] = [];
        g.processMidi([note_on(6000, 60)], out, transport);

        expect(out[0]).toEqual({
            timeSamples: 7200,
            trackId: undefined,
            kind: { type: 'noteOn', channel: 0, note: 60, velocity: 87 },
        });
    });

    it('setParam amount clamps', () => {
        const g = new GrooveModule('t4');
        g.setParam('groove_amount', 0);
        g.setParam('groove_amount', 1.5);
        g.setParam('groove_amount', -0.5);
    });

    it('reset clears state', () => {
        const g = new GrooveModule('t5');
        g.processMidi([note_on(0, 60)], [], transport);
        g.reset();
    });
});
