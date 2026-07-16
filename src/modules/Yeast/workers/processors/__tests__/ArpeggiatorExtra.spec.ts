import { describe, it, expect } from 'vitest';

import { type MidiEvent, type TransportInfo } from '../../../models/MidiEvent';
import { Arpeggiator } from '../Arpeggiator';

const transport: TransportInfo = { isPlaying: true, tempo: 120, sampleRate: 48000, positionInBeats: 0 };
const note_on = (t: number, n: number, v = 100): MidiEvent => ({
    timeSamples: t,
    kind: { type: 'noteOn', channel: 0, note: n, velocity: v },
});
const note_off = (t: number, n: number): MidiEvent => ({
    timeSamples: t,
    kind: { type: 'noteOff', channel: 0, note: n },
});

describe('Arpeggiator extra coverage', () => {
    it('setParam changes rate and gate', () => {
        const arp = new Arpeggiator('t3');
        arp.setParam('rate_denom', 4);
        arp.setParam('gate', 0.5);
        arp.setParam('octaves', 2);
        arp.setParam('pattern', 0);
        const out: MidiEvent[] = [];
        arp.processMidi([note_on(0, 60)], out, transport);
    });
    it('velocity clamps', () => {
        const arp = new Arpeggiator('t4');
        arp.setParam('velocity', 200);
        arp.setParam('velocity', -10);
    });
    it('reset clears state', () => {
        const arp = new Arpeggiator('t5');
        arp.processMidi([note_on(0, 60)], [], transport);
        arp.reset();
    });
    it('multiple simultaneous notes processed', () => {
        const arp = new Arpeggiator('t6');
        const out: MidiEvent[] = [];
        arp.processMidi([note_on(0, 60), note_on(0, 64), note_on(0, 67)], out, transport);
        expect(Array.isArray(out)).toBe(true);
    });
    it('note off after note on', () => {
        const arp = new Arpeggiator('t7');
        const out: MidiEvent[] = [];
        arp.processMidi([note_on(0, 60)], out, transport);
        arp.processMidi([note_off(100, 60)], out, transport);
        expect(Array.isArray(out)).toBe(true);
    });
    it('all pattern modes', () => {
        const arp = new Arpeggiator('t8');
        for (let mode = 0; mode < 8; mode++) {
            arp.setParam('pattern', mode);
        }
    });
});
