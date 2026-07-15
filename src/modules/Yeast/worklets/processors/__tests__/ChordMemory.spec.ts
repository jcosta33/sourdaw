import { describe, it, expect } from 'vitest';

import { type MidiEvent, type TransportInfo } from '../../../models/MidiEvent';
import { ChordMemory } from '../ChordMemory';

const transport: TransportInfo = { isPlaying: true, tempo: 120, sampleRate: 48000, positionInBeats: 0 };
const note_on = (t: number, n: number, v = 100): MidiEvent => ({
    timeSamples: t,
    kind: { type: 'noteOn', channel: 0, note: n, velocity: v },
});
const note_off = (t: number, n: number): MidiEvent => ({
    timeSamples: t,
    kind: { type: 'noteOff', channel: 0, note: n },
});

describe('ChordMemory', () => {
    it('constructs with zero stored chords', () => {
        const cm = new ChordMemory('t1');
        expect(cm.getStoredCount()).toBe(0);
    });

    it('is not learning by default', () => {
        const cm = new ChordMemory('t2');
        expect(cm.isLearning()).toBe(false);
    });

    it('can enter learn mode via a typed command', () => {
        const cm = new ChordMemory('t3');
        cm.executeCommand({ processorId: 't3', type: 'chordMemory.learn' });
        expect(cm.isLearning()).toBe(true);
    });

    it('does not treat one-shot commands as durable parameters', () => {
        const cm = new ChordMemory('t4');
        cm.setParam('learn', 1);
        cm.setParam('clear', 1);
        expect(cm.isLearning()).toBe(false);
    });

    it('passes through note on events', () => {
        const cm = new ChordMemory('t5');
        const out: MidiEvent[] = [];
        cm.processMidi([note_on(0, 60)], out, transport);
        expect(out).toContainEqual(note_on(0, 60));
    });

    it('passes through note off events', () => {
        const cm = new ChordMemory('t6');
        const out: MidiEvent[] = [];
        cm.processMidi([note_off(0, 60)], out, transport);
        expect(out).toContainEqual(note_off(0, 60));
    });

    it('stores chords when learning', () => {
        const cm = new ChordMemory('t7');
        cm.executeCommand({ processorId: 't7', type: 'chordMemory.learn' });
        const out: MidiEvent[] = [];
        cm.processMidi([note_on(0, 60), note_on(0, 64), note_on(0, 67)], out, transport);
        cm.processMidi([note_off(100, 60), note_off(100, 64), note_off(100, 67)], out, transport);
        expect(cm.getStoredCount()).toBeGreaterThan(0);
    });

    it('reset clears learn mode', () => {
        const cm = new ChordMemory('t8');
        cm.executeCommand({ processorId: 't8', type: 'chordMemory.learn' });
        cm.reset();
        expect(cm.isLearning()).toBe(false);
    });

    it('all setParam values accepted', () => {
        const cm = new ChordMemory('t9');
        cm.setParam('learn', 1);
        cm.setParam('clear', 1);
        cm.setParam('trigger_mode', 1);
        cm.setParam('velocity', 80);
        const out: MidiEvent[] = [];
        cm.processMidi([note_on(0, 60)], out, transport);
        expect(out.length).toBeGreaterThan(0);
    });
});
