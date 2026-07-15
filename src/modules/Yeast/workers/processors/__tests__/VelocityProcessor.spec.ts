import { describe, it, expect } from 'vitest';

import { type MidiEvent, type TransportInfo } from '../../../models/MidiEvent';
import { VelocityProcessor } from '../VelocityProcessor';

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

describe('VelocityProcessor', () => {
    it('passthrough mode preserves velocity', () => {
        const vp = new VelocityProcessor('t1');
        const out: MidiEvent[] = [];
        vp.processMidi([note_on(0, 60, 80)], out, transport);
        expect(out[0]?.kind.type).toBe('noteOn');
        if (out[0]?.kind.type === 'noteOn') {
            expect(out[0].kind.velocity).toBe(80);
        }
    });

    it('fixed mode sets all notes to fixed velocity', () => {
        const vp = new VelocityProcessor('t2');
        vp.setParam('mode', 1); // fixed
        vp.setParam('fixed_vel', 64);
        const out: MidiEvent[] = [];
        vp.processMidi([note_on(0, 60, 100)], out, transport);
        if (out[0]?.kind.type === 'noteOn') {
            expect(out[0].kind.velocity).toBe(64);
        }
    });

    it('compress mode reduces dynamic range', () => {
        const vp = new VelocityProcessor('t3');
        vp.setParam('mode', 2); // compress
        vp.setParam('compress_amount', 0.5);
        const out: MidiEvent[] = [];
        vp.processMidi([note_on(0, 60, 127)], out, transport);
        if (out[0]?.kind.type === 'noteOn') {
            expect(out[0].kind.velocity).toBeLessThan(127);
        }
    });

    it('expand mode increases dynamic range', () => {
        const vp = new VelocityProcessor('t4');
        vp.setParam('mode', 3); // expand
        vp.setParam('compress_amount', 1.5);
        const out: MidiEvent[] = [];
        vp.processMidi([note_on(0, 60, 80)], out, transport);
        if (out[0]?.kind.type === 'noteOn') {
            const expanded = 64 + (80 - 64) * 1.5;
            expect(out[0].kind.velocity).toBe(Math.max(1, Math.min(127, Math.round(expanded))));
        }
    });

    it('curve soft mode shapes velocity', () => {
        const vp = new VelocityProcessor('t5');
        vp.setParam('mode', 4); // curve
        vp.setParam('curve', 1); // soft
        const out: MidiEvent[] = [];
        vp.processMidi([note_on(0, 60, 64)], out, transport);
        if (out[0]?.kind.type === 'noteOn') {
            expect(out[0].kind.velocity).toBeGreaterThan(0);
        }
    });

    it('curve hard mode shapes velocity', () => {
        const vp = new VelocityProcessor('t6');
        vp.setParam('mode', 4);
        vp.setParam('curve', 2); // hard
        const out: MidiEvent[] = [];
        vp.processMidi([note_on(0, 60, 64)], out, transport);
        if (out[0]?.kind.type === 'noteOn') {
            expect(out[0].kind.velocity).toBeGreaterThan(0);
        }
    });

    it('random mode produces values in range', () => {
        const vp = new VelocityProcessor('t7');
        vp.setParam('mode', 5); // random
        vp.setParam('random_min', 50);
        vp.setParam('random_max', 80);
        for (let i = 0; i < 10; i++) {
            const out: MidiEvent[] = [];
            vp.processMidi([note_on(i, 60)], out, transport);
            if (out[0]?.kind.type === 'noteOn') {
                expect(out[0].kind.velocity).toBeGreaterThanOrEqual(50);
                expect(out[0].kind.velocity).toBeLessThanOrEqual(80);
            }
        }
    });

    it('passes through note off events unchanged', () => {
        const vp = new VelocityProcessor('t8');
        const input = [note_off(0, 60)];
        const out: MidiEvent[] = [];
        vp.processMidi(input, out, transport);
        expect(out).toContainEqual(input[0]);
    });

    it('clamps velocity to MIDI range', () => {
        const vp = new VelocityProcessor('t9');
        vp.setParam('mode', 1);
        vp.setParam('fixed_vel', 200);
        const out: MidiEvent[] = [];
        vp.processMidi([note_on(0, 60)], out, transport);
        if (out[0]?.kind.type === 'noteOn') {
            expect(out[0].kind.velocity).toBeLessThanOrEqual(127);
        }
    });
});
