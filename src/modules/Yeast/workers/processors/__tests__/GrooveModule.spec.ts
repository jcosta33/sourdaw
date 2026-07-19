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
const note_off = (t: number, n: number): MidiEvent => ({
    timeSamples: t,
    kind: { type: 'noteOff', channel: 0, note: n },
});

describe('GrooveModule', () => {
    it('constructs with the provided id and processor name', () => {
        const g = new GrooveModule('t1');
        expect(g.id).toBe('t1');
        expect(g.name).toBe('Groove');
    });

    it('passes through note on events', () => {
        const g = new GrooveModule('t2');
        const out: MidiEvent[] = [];
        g.processMidi([note_on(0, 60)], out, transport);
        expect(out.length).toBeGreaterThan(0);
    });

    it('setParam selects template', () => {
        const g = new GrooveModule('t3');
        g.setParam('template', 1); // MPC Swing: offsets [0, 0.12, 0, 0.12, ...]
        g.setParam('amount', 1); // full effect, isolate the template's own offset
        const out: MidiEvent[] = [];
        // 120bpm/48kHz => samplesPerBeat 24000; 16th-note stepLen 6000.
        // timeSamples 6000 => beatPos 0.25 => stepIdx 1 => offset 0.12 * 1 * 6000 = 720.
        g.processMidi([note_on(6000, 60)], out, transport);

        expect(out).toHaveLength(1);
        expect(out[0]?.timeSamples).toBe(6720);
    });

    it('setParam amount clamps to the 0-1 range', () => {
        const g = new GrooveModule('t4');
        g.setParam('template', 1); // MPC Swing, nonzero offset at step 1

        g.setParam('amount', 1.5); // above range, should clamp to 1
        const overshoot: MidiEvent[] = [];
        g.processMidi([note_on(6000, 60)], overshoot, transport);
        expect(overshoot[0]?.timeSamples).toBe(6720); // offset = 0.12 * 1 * 6000

        g.setParam('amount', -0.5); // below range, should clamp to 0
        const undershoot: MidiEvent[] = [];
        g.processMidi([note_on(6000, 60)], undershoot, transport);
        expect(undershoot[0]?.timeSamples).toBe(6000); // offset = 0.12 * 0 * 6000
    });

    it('reset clears queued note-off timing state', () => {
        const g = new GrooveModule('t5');
        g.setParam('template', 1); // MPC Swing, nonzero offset at step 1
        g.setParam('amount', 1);
        // Queue a 720-sample note-off offset for note 60 via the matching note-on.
        g.processMidi([note_on(6000, 60)], [], transport);

        g.reset();

        const out: MidiEvent[] = [];
        g.processMidi([note_off(6000, 60)], out, transport);

        // After reset the queued voice offset is gone, so the note-off falls back
        // to an unshifted (0-offset) time instead of the pre-reset 720.
        expect(out[0]?.timeSamples).toBe(6000);
    });
});
