import { describe, it, expect } from 'vitest';

import { type MidiEvent, type TransportInfo } from '../../../models/MidiEvent';
import { Harmonizer } from '../Harmonizer';

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

describe('Harmonizer', () => {
    it('passes through original note and adds harmony', () => {
        const h = new Harmonizer('t1');
        const out: MidiEvent[] = [];
        h.processMidi([note_on(0, 60)], out, transport);
        const ons = out.filter((e) => e.kind.type === 'noteOn');
        expect(ons.length).toBe(2);
    });

    it('multiple voices add more harmony', () => {
        const h = new Harmonizer('t2');
        h.setParam('voice1_enabled', 1);
        const out: MidiEvent[] = [];
        h.processMidi([note_on(0, 60)], out, transport);
        expect(out.filter((e) => e.kind.type === 'noteOn').length).toBe(3);
    });

    it('disabled voices produce no harmony', () => {
        const h = new Harmonizer('t3');
        h.setParam('voice0_enabled', 0);
        const out: MidiEvent[] = [];
        h.processMidi([note_on(0, 60)], out, transport);
        expect(out.filter((e) => e.kind.type === 'noteOn').length).toBe(1);
    });

    it('note off emits harmony note offs', () => {
        const h = new Harmonizer('t4');
        const out: MidiEvent[] = [];
        h.processMidi([note_on(0, 60)], out, transport);
        h.processMidi([note_off(100, 60)], out, transport);
        expect(out.filter((e) => e.kind.type === 'noteOff').length).toBe(2);
    });

    it('reset clears state', () => {
        const h = new Harmonizer('t5');
        const out: MidiEvent[] = [];
        h.processMidi([note_on(0, 60)], out, transport);
        h.reset();
        h.processMidi([note_off(100, 60)], out, transport);
        expect(out.filter((e) => e.kind.type === 'noteOff').length).toBe(1);
    });

    it('scale change produces different harmony', () => {
        const h_major = new Harmonizer('m');
        const h_minor = new Harmonizer('mi');
        h_minor.setParam('scale', 1);
        const out_m: MidiEvent[] = [];
        const out_mi: MidiEvent[] = [];
        h_major.processMidi([note_on(0, 60)], out_m, transport);
        h_minor.processMidi([note_on(0, 60)], out_mi, transport);
        const harm_m = out_m[1];
        const harm_mi = out_mi[1];
        if (harm_m && harm_mi && harm_m.kind.type === 'noteOn' && harm_mi.kind.type === 'noteOn') {
            expect(harm_m.kind.note).not.toBe(harm_mi.kind.note);
        }
    });

    it('velocity offset applied to harmony', () => {
        const h = new Harmonizer('t6');
        h.setParam('voice0_vel_offset', -30);
        const out: MidiEvent[] = [];
        h.processMidi([note_on(0, 60, 100)], out, transport);
        const harm = out[1];
        if (harm && harm.kind.type === 'noteOn') {
            expect(harm.kind.velocity).toBeLessThan(100);
        }
    });

    it('all setParam values accepted', () => {
        const h = new Harmonizer('t7');
        h.setParam('root', 7);
        h.setParam('scale', 2);
        h.setParam('voice0_degrees', 3);
        h.setParam('voice1_degrees', 5);
        h.setParam('voice2_degrees', -2);
        h.setParam('voice0_enabled', 1);
        h.setParam('voice1_enabled', 1);
        h.setParam('voice2_enabled', 1);
        h.setParam('voice0_vel_offset', -10);
        h.setParam('voice1_vel_offset', -15);
        h.setParam('voice2_vel_offset', -20);
        const out: MidiEvent[] = [];
        h.processMidi([note_on(0, 60)], out, transport);
        expect(out.length).toBeGreaterThan(0);
    });
});
