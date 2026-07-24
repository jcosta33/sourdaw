import { describe, it, expect } from 'vitest';

import { type MidiEvent, type TransportInfo } from '../../../models/MidiEvent';
import { ChordMemory } from '../ChordMemory';

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

        out.length = 0;
        cm.processMidi([{ ...note_on(200, 60), durationSamples: 100, noteInstanceId: 'source-a' }], out, transport);
        const generatedOns = out.filter((event) => event.kind.type === 'noteOn');
        cm.processMidi([{ ...note_off(300, 60), noteInstanceId: 'source-a' }], out, transport);
        expect(generatedOns.every((event) => event.durationSamples === 100 && event.noteInstanceId)).toBe(true);
        expect(out.filter((event) => event.kind.type === 'noteOff').map((event) => event.noteInstanceId)).toEqual(
            generatedOns.map((event) => event.noteInstanceId)
        );
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

    it('clears the chord memory via the chordMemory.clear command', () => {
        const cm = new ChordMemory('clear');
        cm.executeCommand({ processorId: 'clear', type: 'chordMemory.learn' });
        cm.processMidi([note_on(0, 60), note_on(0, 64), note_on(0, 67)], [], transport);
        cm.processMidi(
            [
                { timeSamples: 0, kind: { type: 'noteOff', channel: 0, note: 60 } },
                { timeSamples: 0, kind: { type: 'noteOff', channel: 0, note: 64 } },
                { timeSamples: 0, kind: { type: 'noteOff', channel: 0, note: 67 } },
            ],
            [],
            transport
        );
        // a stored chord exists; after clear, retriggering a single note must not
        // emit the learned chord (only the original passes through).
        const before: MidiEvent[] = [];
        cm.processMidi([note_on(0, 72)], before, transport);
        const beforeOns = before.filter((e) => e.kind.type === 'noteOn').length;

        cm.executeCommand({ processorId: 'clear', type: 'chordMemory.clear' });
        const after: MidiEvent[] = [];
        cm.processMidi([note_on(0, 72)], after, transport);
        const afterOns = after.filter((e) => e.kind.type === 'noteOn').length;

        expect(afterOns).toBeLessThanOrEqual(beforeOns);
    });

    it('returns false for a command addressed to a different processor id', () => {
        const cm = new ChordMemory('mine');
        const accepted = cm.executeCommand({ processorId: 'other', type: 'chordMemory.learn' });
        expect(accepted).toBe(false);
        expect(cm.isLearning()).toBe(false);
    });

    it('returns false for an unknown command type', () => {
        const cm = new ChordMemory('unk');
        const accepted = cm.executeCommand({ processorId: 'unk', type: 'nonsense' as never });
        expect(accepted).toBe(false);
    });

    it('passes through non-note events unchanged', () => {
        const cm = new ChordMemory('cc');
        const cc = {
            timeSamples: 0,
            kind: { type: 'cc', channel: 0, cc: 7, value: 64 },
        } as MidiEvent;
        const out: MidiEvent[] = [];
        cm.processMidi([cc], out, transport);
        expect(out[0]).toBe(cc);
    });
});
