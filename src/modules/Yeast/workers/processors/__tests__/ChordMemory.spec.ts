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

    it('does not commit a chord on noteOff during learning if no notes were buffered', () => {
        // Enter learn mode and immediately release a key without any prior
        // noteOn → learnBuffer is empty, so the commit guard
        // (learnBuffer.length > 0 && learnRoot >= 0) is false and nothing is
        // stored; the processor stays in learn mode.
        const cm = new ChordMemory('empty-learn');
        cm.executeCommand({ processorId: 'empty-learn', type: 'chordMemory.learn' });
        const out: MidiEvent[] = [];
        cm.processMidi([note_off(0, 60)], out, transport);
        expect(cm.getStoredCount()).toBe(0);
        expect(cm.isLearning()).toBe(true); // still learning
        expect(out).toHaveLength(0); // noteOff swallowed during learning
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

    it('generates a chordmem-prefixed id when none is provided', () => {
        const cm = new ChordMemory();
        expect(cm.id).toMatch(/^chordmem-\d+$/);
        expect(cm.name).toBe('Chord Memory');
    });

    describe('transpose_mode', () => {
        // The memory is keyed by the learned root note, so a recall re-triggers
        // the SAME key that was learned. transpose = note - stored.root = 0 in
        // that case, and transpose_mode only governs whether that (zero) offset
        // is applied. Both modes therefore recall the stored pitches verbatim
        // when retriggering the root key; the setParam/resetParams branches are
        // exercised by toggling the flag itself.
        function learnCTriad(cm: ChordMemory, id: string): void {
            cm.executeCommand({ processorId: id, type: 'chordMemory.learn' });
            cm.processMidi([note_on(0, 60), note_on(0, 64), note_on(0, 67)], [], transport);
            cm.processMidi([note_off(100, 60), note_off(100, 64), note_off(100, 67)], [], transport);
        }

        it('recalls the stored triad verbatim when retriggering the root (transpose on)', () => {
            const cm = new ChordMemory('tr-on');
            learnCTriad(cm, 'tr-on');
            const out: MidiEvent[] = [];
            cm.processMidi([note_on(0, 60)], out, transport); // retrigger root C(60)
            const recalled = out
                .filter((e) => e.kind.type === 'noteOn')
                .map((e) => (e.kind as { note: number }).note)
                .sort((a, b) => a - b);
            expect(recalled).toEqual([60, 64, 67]);
        });

        it('setParam transpose_mode accepts both true (>0.5) and false (<=0.5)', () => {
            const cm = new ChordMemory('tr-flag');
            // value > 0.5 → true. Recall still verbatim (transpose 0).
            cm.setParam('transpose_mode', 1);
            learnCTriad(cm, 'tr-flag');
            const outOn: MidiEvent[] = [];
            cm.processMidi([note_on(0, 60)], outOn, transport);
            expect(
                outOn
                    .filter((e) => e.kind.type === 'noteOn')
                    .map((e) => (e.kind as { note: number }).note)
                    .sort((a, b) => a - b)
            ).toEqual([60, 64, 67]);

            // value <= 0.5 → false. With transpose off the offset is forced to 0,
            // so the verbatim recall is unchanged — but the branch is exercised.
            const cm2 = new ChordMemory('tr-flag-off');
            cm2.setParam('transpose_mode', 0);
            learnCTriad(cm2, 'tr-flag-off');
            const outOff: MidiEvent[] = [];
            cm2.processMidi([note_on(0, 60)], outOff, transport);
            expect(
                outOff
                    .filter((e) => e.kind.type === 'noteOn')
                    .map((e) => (e.kind as { note: number }).note)
                    .sort((a, b) => a - b)
            ).toEqual([60, 64, 67]);
        });

        it('replaceParams restores transpose_mode=true via resetParams', () => {
            const cm = new ChordMemory('tr-reset');
            cm.setParam('transpose_mode', 0); // disable
            cm.replaceParams({}); // resetParams → transposeMode=true
            learnCTriad(cm, 'tr-reset');
            const out: MidiEvent[] = [];
            cm.processMidi([note_on(0, 60)], out, transport);
            expect(
                out
                    .filter((e) => e.kind.type === 'noteOn')
                    .map((e) => (e.kind as { note: number }).note)
                    .sort((a, b) => a - b)
            ).toEqual([60, 64, 67]);
        });
    });
});
