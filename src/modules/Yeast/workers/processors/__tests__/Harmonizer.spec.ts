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
    it('generates a harmonizer-prefixed id when none is provided', () => {
        const h = new Harmonizer();
        expect(h.id).toMatch(/^harmonizer-\d+$/);
        expect(h.name).toBe('Harmonizer');
    });

    it('passes non-noteOn/non-noteOff events (e.g. CC) through unchanged', () => {
        // Exercises the implicit-fall-through branch of the noteOn/noteOff
        // dispatch: a CC event must pass through untouched, with no harmony.
        const h = new Harmonizer('cc');
        const cc: MidiEvent = {
            timeSamples: 0,
            kind: { type: 'cc', channel: 0, cc: 7, value: 64 },
        };
        const out: MidiEvent[] = [];
        h.processMidi([cc], out, transport);
        expect(out).toHaveLength(1);
        expect(out[0]).toBe(cc);
    });

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
        const sourceOn = { ...note_on(0, 60), durationSamples: 100, noteInstanceId: 'source-a' };
        h.processMidi([sourceOn], out, transport);
        h.processMidi([{ ...note_off(100, 60), noteInstanceId: 'source-a' }], out, transport);
        expect(out.filter((e) => e.kind.type === 'noteOff').length).toBe(2);
        const harmonyOn = out.find((event) => event.kind.type === 'noteOn' && event.kind.note !== 60);
        expect(harmonyOn).toEqual(expect.objectContaining({ durationSamples: 100 }));
        expect(
            out.some((event) => event.kind.type === 'noteOff' && event.noteInstanceId === harmonyOn?.noteInstanceId)
        ).toBe(true);
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

    it('transposes a major-scale note up two diatonic degrees (C→E, 60→64)', () => {
        // major pattern [0,2,4,5,7,9,11]; C(60)=degree 0 → +2 degrees = degree 2 = E(64)
        const h = new Harmonizer('dia');
        const out: MidiEvent[] = [];
        h.processMidi([note_on(0, 60)], out, transport);
        const harmony = out.find((e) => e.kind.type === 'noteOn' && e.kind.note !== 60);
        expect(harmony?.kind).toMatchObject({ type: 'noteOn', note: 64 });
    });

    it('clamps the harmony velocity to [1,127]', () => {
        const h = new Harmonizer('clamp');
        h.setParam('voice0_vel_offset', -200); // 100 - 200 → clamped to 1
        const out: MidiEvent[] = [];
        h.processMidi([note_on(0, 60, 100)], out, transport);
        const harmony = out.find((e) => e.kind.type === 'noteOn' && e.kind.note !== 60);
        expect(harmony?.kind).toMatchObject({ velocity: 1 });
    });

    it('skips a harmony voice whose transposed note falls outside 0–127', () => {
        const h = new Harmonizer('oor');
        h.setParam('voice2_enabled', 1); // degrees -1, below
        h.setParam('voice0_enabled', 0); // disable the 3rd voice
        const out: MidiEvent[] = [];
        // note 0 transposed down a degree → negative → skipped; only original passes
        h.processMidi([note_on(0, 0)], out, transport);
        expect(out.filter((e) => e.kind.type === 'noteOn').length).toBe(1);
    });

    it('skips a harmony voice whose computed duration is zero', () => {
        const h = new Harmonizer('zero');
        const out: MidiEvent[] = [];
        h.processMidi([{ ...note_on(0, 60), durationSamples: 0 }], out, transport);
        // original always passes; the harmony voice is skipped (duration 0)
        expect(out.filter((e) => e.kind.type === 'noteOn').length).toBe(1);
    });

    it('falls back to the major scale for an out-of-range scale index', () => {
        const h = new Harmonizer('fallback');
        h.setParam('scale', 99);
        const out: MidiEvent[] = [];
        h.processMidi([note_on(0, 60)], out, transport);
        const harmony = out.find((e) => e.kind.type === 'noteOn' && e.kind.note !== 60);
        expect(harmony?.kind).toMatchObject({ note: 64 });
    });

    // replaceParams calls resetParams() first (root/scale/voices → defaults),
    // then reapplies the given params. The default voice config is a single
    // enabled diatonic-third (+2 degrees); the other two voices start disabled.
    describe('replaceParams resets voices to defaults before re-applying', () => {
        it('restores the default single-third harmony after custom voices are configured', () => {
            const h = new Harmonizer('reset-voices');
            // Configure a custom 2-voice harmony (third + fifth), confirming it
            // produces 3 noteOns (original + 2 harmony voices).
            h.setParam('voice1_enabled', 1);
            let out: MidiEvent[] = [];
            h.processMidi([note_on(0, 60)], out, transport);
            expect(out.filter((e) => e.kind.type === 'noteOn').length).toBe(3);

            // replaceParams with an empty map resets to defaults: only the
            // third voice is enabled again → 2 noteOns (original + 1 harmony).
            h.replaceParams({});
            out = [];
            h.processMidi([note_on(0, 60)], out, transport);
            const ons = out.filter((e) => e.kind.type === 'noteOn');
            expect(ons.length).toBe(2);
            // Default harmony is a diatonic third above C in C major → E(64).
            const harmony = ons.find((e) => (e.kind as { note: number }).note !== 60);
            expect(harmony?.kind).toMatchObject({ note: 64 });
        });
    });
});
