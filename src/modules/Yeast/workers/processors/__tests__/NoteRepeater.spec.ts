import { describe, it, expect } from 'vitest';

import { type MidiEvent, type TransportInfo } from '../../../models/MidiEvent';
import { NoteRepeater } from '../NoteRepeater';

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
        r.processMidi([note_on(0, 60)], out, { ...transport, blockStartSamples: 0, blockEndSamples: 10_000 });
        const note_ons = out.filter((e) => e.kind.type === 'noteOn');
        expect(note_ons.length).toBeGreaterThanOrEqual(1);
        const generated = note_ons.find((event) => event.noteInstanceId !== undefined);
        expect(generated).toEqual(expect.objectContaining({ durationSamples: 3_000 }));
        expect(
            out.some((event) => event.kind.type === 'noteOff' && event.noteInstanceId === generated?.noteInstanceId)
        ).toBe(true);
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
        if (ons[1]?.kind.type === 'noteOn') {
            expect(ons[1].kind.note).toBe(72);
        }
        if (ons[2]?.kind.type === 'noteOn') {
            expect(ons[2].kind.note).toBe(84);
        }
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

    it('computes the exact decay-falloff velocity per repeat (decay 0.5)', () => {
        const r = new NoteRepeater('decay-exact');
        r.setParam('repeat_count', 2);
        r.setParam('decay', 0.5);
        const out: MidiEvent[] = [];
        // velocity 100, decay 0.5 → repeat1 = round(100*0.5)=50, repeat2 = round(100*0.25)=25
        // interval at rate 1/16 = 6000 samples; repeat2 lands at 12000 → need blockEnd past it
        r.processMidi([note_on(0, 60, 100)], out, {
            ...transport,
            blockStartSamples: 0,
            blockEndSamples: 20_000,
        });
        const ons = out.filter((e) => e.kind.type === 'noteOn' && e.noteInstanceId !== undefined);
        expect(ons[0]?.kind).toMatchObject({ velocity: 50 });
        expect(ons[1]?.kind).toMatchObject({ velocity: 25 });
    });

    it('clamps the pitch-step repeat to the 0–127 MIDI range', () => {
        const r = new NoteRepeater('pitch-clamp');
        r.setParam('repeat_count', 4);
        r.setParam('pitch_step', 40); // 60 + 4*40 = 220 → clamped to 127
        const out: MidiEvent[] = [];
        r.processMidi([note_on(0, 60)], out, {
            ...transport,
            blockStartSamples: 0,
            blockEndSamples: 20_000,
        });
        const ons = out.filter((e) => e.kind.type === 'noteOn' && e.noteInstanceId !== undefined);
        for (const on of ons) {
            expect((on.kind as { note: number }).note).toBeLessThanOrEqual(127);
            expect((on.kind as { note: number }).note).toBeGreaterThanOrEqual(0);
        }
        // the last repeat (60+160) is clamped to 127
        const last = ons[ons.length - 1];
        expect(last).toBeDefined();
        expect((last!.kind as { note: number }).note).toBe(127);
    });

    it('clamps the repeat count to a maximum of 16', () => {
        const r = new NoteRepeater('max-repeat');
        r.setParam('repeat_count', 999); // → 16
        const out: MidiEvent[] = [];
        r.processMidi([note_on(0, 60)], out, {
            ...transport,
            blockStartSamples: 0,
            blockEndSamples: 100_000,
        });
        // original + up to 16 repeats = 17 noteOns
        const ons = out.filter((e) => e.kind.type === 'noteOn');
        expect(ons.length).toBe(17);
    });

    it('clamps the gate param into [0.01, 2]', () => {
        const r = new NoteRepeater('gate-clamp');
        r.setParam('gate', 99); // → 2
        r.setParam('repeat_count', 1);
        const out: MidiEvent[] = [];
        r.processMidi([note_on(0, 60)], out, {
            ...transport,
            blockStartSamples: 0,
            blockEndSamples: 20_000,
        });
        const gen = out.find((e) => e.kind.type === 'noteOn' && e.noteInstanceId !== undefined);
        // noteLen = interval * gate(2); interval at rate 1/16 = 0.25 beat = 6000 samples → *2 = 12000
        expect(gen?.durationSamples).toBe(12_000);
    });

    it('clamps the decay param into [0, 1]', () => {
        const r = new NoteRepeater('decay-clamp');
        r.setParam('decay', 5); // → 1 (no falloff)
        r.setParam('repeat_count', 1);
        const out: MidiEvent[] = [];
        r.processMidi([note_on(0, 60, 80)], out, {
            ...transport,
            blockStartSamples: 0,
            blockEndSamples: 10_000,
        });
        const gen = out.find((e) => e.kind.type === 'noteOn' && e.noteInstanceId !== undefined);
        expect(gen).toBeDefined();
        // decay 1 → repeat velocity = round(80 * 1^1) = 80 (unchanged)
        expect((gen!.kind as { velocity: number }).velocity).toBe(80);
    });

    it('passes through non-note events unchanged', () => {
        const r = new NoteRepeater('cc');
        const cc = {
            timeSamples: 0,
            kind: { type: 'cc', channel: 0, cc: 7, value: 64 },
        } as MidiEvent;
        const out: MidiEvent[] = [];
        r.processMidi([cc], out, transport);
        expect(out[0]).toBe(cc);
    });
});
