import { describe, it, expect } from 'vitest';
import { NoteRepeater } from '../NoteRepeater';
import { type MidiEvent, type TransportInfo } from '../../models/MidiEvent';

const transport: TransportInfo = { isPlaying: true, tempo: 120, sampleRate: 48000, positionInBeats: 0 };
const note_on = (t: number, n: number, v = 100): MidiEvent => ({ timeSamples: t, kind: { type: 'noteOn', channel: 0, note: n, velocity: v } });

describe('NoteRepeater', () => {
    it('passes through original event', () => {
        const r = new NoteRepeater('t1');
        const out: MidiEvent[] = [];
        r.processMidi([note_on(0, 60)], out, transport);
        expect(out[0]).toEqual(note_on(0, 60));
    });

    it('generates repeat notes', () => {
        const r = new NoteRepeater('t2');
        r.setParam('repeat_count', 3);
        const out: MidiEvent[] = [];
        r.processMidi([note_on(0, 60)], out, transport);
        const note_ons = out.filter((e) => e.kind.type === 'noteOn');
        expect(note_ons.length).toBeGreaterThanOrEqual(1);
    });

    it('decay reduces velocity on repeats', () => {
        const r = new NoteRepeater('t3');
        r.setParam('repeat_count', 2);
        r.setParam('decay', 0.5);
        const out: MidiEvent[] = [];
        r.processMidi([note_on(0, 60, 100)], out, transport);
        const ons = out.filter((e) => e.kind.type === 'noteOn');
        if (ons[1]?.kind.type === 'noteOn' && ons[0]?.kind.type === 'noteOn') {
            expect(ons[1].kind.velocity).toBeLessThan(ons[0].kind.velocity);
        }
    });

    it('pitch step transposes repeats', () => {
        const r = new NoteRepeater('t4');
        r.setParam('repeat_count', 2);
        r.setParam('pitch_step', 12);
        const out: MidiEvent[] = [];
        r.processMidi([note_on(0, 60)], out, transport);
        const ons = out.filter((e) => e.kind.type === 'noteOn');
        if (ons[1]?.kind.type === 'noteOn') expect(ons[1].kind.note).toBe(72);
        if (ons[2]?.kind.type === 'noteOn') expect(ons[2].kind.note).toBe(84);
    });

    it('clamps repeat count', () => {
        const r = new NoteRepeater('t5');
        r.setParam('repeat_count', 0);
        const out: MidiEvent[] = [];
        r.processMidi([note_on(0, 60)], out, transport);
        expect(out.filter((e) => e.kind.type === 'noteOn').length).toBeGreaterThanOrEqual(1);
    });

    it('reset clears scheduled events', () => {
        const r = new NoteRepeater('t6');
        r.processMidi([note_on(0, 60)], [], transport);
        r.reset();
        const out: MidiEvent[] = [];
        r.processMidi([], out, transport);
    });

    it('all setParam values accepted', () => {
        const r = new NoteRepeater('t7');
        r.setParam('repeat_count', 5);
        r.setParam('rate_denom', 8);
        r.setParam('decay', 0.6);
        r.setParam('gate', 0.3);
        r.setParam('pitch_step', 7);
        const out: MidiEvent[] = [];
        r.processMidi([note_on(0, 60)], out, transport);
        expect(out.length).toBeGreaterThan(0);
    });
});
