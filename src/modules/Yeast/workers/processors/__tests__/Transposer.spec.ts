import { describe, it, expect, beforeEach } from 'vitest';

import { type MidiEvent, type MidiEventKind, type TransportInfo } from '../../../models/MidiEvent';
import { Transposer } from '../Transposer';

type NoteOnEvent = MidiEvent & { kind: Extract<MidiEventKind, { type: 'noteOn' }> };
type NoteOffEvent = MidiEvent & { kind: Extract<MidiEventKind, { type: 'noteOff' }> };

function isNoteOn(event: MidiEvent): event is NoteOnEvent {
    return event.kind.type === 'noteOn';
}

function isNoteOff(event: MidiEvent): event is NoteOffEvent {
    return event.kind.type === 'noteOff';
}

describe('Transposer', () => {
    let trans: Transposer;
    let transport: TransportInfo;

    beforeEach(() => {
        trans = new Transposer('test-trans');
        transport = {
            isPlaying: true,
            ppqPosition: 0,
            bpm: 120,
            sampleRate: 44100,
            barIndex: 0,
            beatInBar: 0,
            timeSigNum: 4,
            timeSigDen: 4,
            loopEnabled: false,
            loopStartPpq: 0,
            loopEndPpq: 0,
        };
    });

    it('reads an inverted clamp window as the same window', () => {
        // No UI reaches this pair; a stored project, a CRDT merge, or an
        // AI-authored action can. Applied in the stored order the outer
        // `Math.max(clampMin, …)` wins outright, pinning every note to
        // clamp_min (72) and ignoring the clamp_max ceiling (48) entirely.
        trans.setParam('clamp_min', 72);
        trans.setParam('clamp_max', 48);

        const output: MidiEvent[] = [];
        trans.processMidi(
            [
                { timeSamples: 0, kind: { type: 'noteOn', channel: 0, note: 24, velocity: 100 } },
                { timeSamples: 1, kind: { type: 'noteOn', channel: 0, note: 60, velocity: 100 } },
                { timeSamples: 2, kind: { type: 'noteOn', channel: 0, note: 100, velocity: 100 } },
            ],
            output,
            transport
        );

        // The window is [48, 72] whichever end each param was stored in.
        expect(output.filter(isNoteOn).map((event) => event.kind.note)).toEqual([48, 60, 72]);
    });

    it('shifts notes by semitones and octaves', () => {
        trans.setParam('semitones', 2);
        trans.setParam('octaves', 1); // Total = +14 semitones

        const input: MidiEvent[] = [{ timeSamples: 0, kind: { type: 'noteOn', channel: 0, note: 60, velocity: 100 } }];
        const output: MidiEvent[] = [];

        trans.processMidi(input, output, transport);

        const noteOn = output.find(isNoteOn);
        expect(noteOn?.kind.note).toBe(74); // 60 + 14
    });

    it('tracks transposition for Note Off', () => {
        trans.setParam('semitones', 7);

        const onInput: MidiEvent[] = [
            { timeSamples: 0, kind: { type: 'noteOn', channel: 0, note: 60, velocity: 100 } },
        ];
        const output: MidiEvent[] = [];
        trans.processMidi(onInput, output, transport);

        const offInput: MidiEvent[] = [{ timeSamples: 500, kind: { type: 'noteOff', channel: 0, note: 60 } }];
        trans.processMidi(offInput, output, transport);

        const noteOff = output.find(isNoteOff);
        expect(noteOff?.kind.note).toBe(67); // 60 + 7
    });

    it('clamps notes to range', () => {
        trans.setParam('semitones', -100);
        trans.setParam('clamp_min', 12);

        const input: MidiEvent[] = [{ timeSamples: 0, kind: { type: 'noteOn', channel: 0, note: 60, velocity: 100 } }];
        const output: MidiEvent[] = [];

        trans.processMidi(input, output, transport);

        const noteOn = output.find(isNoteOn);
        expect(noteOn?.kind.note).toBe(12);
    });

    it('clamps upward to clamp_max', () => {
        trans.setParam('semitones', 100);
        trans.setParam('clamp_max', 100);

        const input: MidiEvent[] = [{ timeSamples: 0, kind: { type: 'noteOn', channel: 0, note: 60, velocity: 100 } }];
        const output: MidiEvent[] = [];
        trans.processMidi(input, output, transport);

        expect(output.find(isNoteOn)?.kind.note).toBe(100);
    });

    it('clamps the clamp_min/clamp_max params themselves into [0,127]', () => {
        trans.setParam('clamp_min', -50);
        trans.setParam('semitones', -200);
        // min clamped to 0: 60-200 → 0
        const out1: MidiEvent[] = [];
        trans.processMidi(
            [{ timeSamples: 0, kind: { type: 'noteOn', channel: 0, note: 60, velocity: 100 } }],
            out1,
            transport
        );
        expect(out1.find(isNoteOn)?.kind.note).toBe(0);

        // max clamped to 127: a fresh processor, semitones +200
        const trans2 = new Transposer('t2');
        trans2.setParam('clamp_max', 999);
        trans2.setParam('semitones', 200);
        const out2: MidiEvent[] = [];
        trans2.processMidi(
            [{ timeSamples: 0, kind: { type: 'noteOn', channel: 0, note: 60, velocity: 100 } }],
            out2,
            transport
        );
        expect(out2.find(isNoteOn)?.kind.note).toBe(127);
    });

    it('applies a random offset within ±random_range, then clamps', () => {
        trans.setParam('semitones', 0);
        trans.setParam('random_range', 12);
        // clamp both ends to 60 → whatever the random offset, result is 60
        trans.setParam('clamp_min', 60);
        trans.setParam('clamp_max', 60);

        const input: MidiEvent[] = [{ timeSamples: 0, kind: { type: 'noteOn', channel: 0, note: 50, velocity: 100 } }];
        const output: MidiEvent[] = [];
        trans.processMidi(input, output, transport);
        expect(output.find(isNoteOn)?.kind.note).toBe(60);
    });

    it('keeps the transposed pitch bounded across many random_range notes', () => {
        trans.setParam('semitones', 12);
        trans.setParam('random_range', 5);

        const notes: number[] = [];
        for (let i = 0; i < 32; i++) {
            const out: MidiEvent[] = [];
            trans.processMidi(
                [{ timeSamples: 0, kind: { type: 'noteOn', channel: 0, note: 60, velocity: 100 } }],
                out,
                transport
            );
            notes.push(out.find(isNoteOn)!.kind.note);
        }
        // 60 + 12 ± 5 → in [67, 77]
        for (const note of notes) {
            expect(note).toBeGreaterThanOrEqual(67);
            expect(note).toBeLessThanOrEqual(77);
        }
        // variation occurred (random path exercised), not all identical
        expect(new Set(notes).size).toBeGreaterThan(1);
    });

    it('falls back to the original pitch on a noteOff with no tracked voice', () => {
        const off: MidiEvent[] = [{ timeSamples: 0, kind: { type: 'noteOff', channel: 0, note: 55 } }];
        const output: MidiEvent[] = [];
        trans.processMidi(off, output, transport);
        expect(output.find(isNoteOff)?.kind.note).toBe(55);
    });

    it('passes through non-note events unchanged', () => {
        const cc = {
            timeSamples: 0,
            kind: { type: 'cc', channel: 0, cc: 7, value: 64 },
        } as MidiEvent;
        const output: MidiEvent[] = [];
        trans.processMidi([cc], output, transport);
        expect(output[0]).toBe(cc);
    });

    it('preserves the channel + velocity on the transposed noteOn', () => {
        trans.setParam('semitones', 5);
        const output: MidiEvent[] = [];
        trans.processMidi(
            [{ timeSamples: 0, kind: { type: 'noteOn', channel: 3, note: 60, velocity: 88 } }],
            output,
            transport
        );
        expect(output.find(isNoteOn)?.kind).toMatchObject({ channel: 3, velocity: 88, note: 65 });
    });

    it('reset() clears tracked voices so a subsequent noteOff falls back to its input pitch', () => {
        trans.setParam('semitones', 7);
        // hold a note, then reset, then release → release no longer tracks the +7
        trans.processMidi(
            [{ timeSamples: 0, kind: { type: 'noteOn', channel: 0, note: 60, velocity: 100 } }],
            [],
            transport
        );
        trans.reset();
        const out: MidiEvent[] = [];
        trans.processMidi([{ timeSamples: 1, kind: { type: 'noteOff', channel: 0, note: 60 } }], out, transport);
        expect(out.find(isNoteOff)?.kind.note).toBe(60);
    });

    // replaceParams calls resetParams() first (semitones/octaves/random/clamp →
    // defaults: 0 offset, no random, full 0–127 range), then re-applies.
    describe('replaceParams resets params to defaults before re-applying', () => {
        it('clears a configured transpose offset back to unison', () => {
            trans.setParam('semitones', 12);
            let out: MidiEvent[] = [];
            trans.processMidi(
                [{ timeSamples: 0, kind: { type: 'noteOn', channel: 0, note: 60, velocity: 100 } }],
                out,
                transport
            );
            expect(out.find(isNoteOn)?.kind.note).toBe(72); // +12

            // replaceParams with empty map → semitones reset to 0 → unison.
            trans.replaceParams({});
            out = [];
            trans.processMidi(
                [{ timeSamples: 0, kind: { type: 'noteOn', channel: 0, note: 60, velocity: 100 } }],
                out,
                transport
            );
            expect(out.find(isNoteOn)?.kind.note).toBe(60);
        });

        it('clears a configured random range and clamp window back to defaults', () => {
            trans.setParam('random_range', 12);
            trans.setParam('clamp_min', 60);
            trans.setParam('clamp_max', 60);
            let out: MidiEvent[] = [];
            trans.processMidi(
                [{ timeSamples: 0, kind: { type: 'noteOn', channel: 0, note: 50, velocity: 100 } }],
                out,
                transport
            );
            expect(out.find(isNoteOn)?.kind.note).toBe(60); // clamped to 60

            // replaceParams with empty map → no random, full range → note passes at 50.
            trans.replaceParams({});
            out = [];
            trans.processMidi(
                [{ timeSamples: 0, kind: { type: 'noteOn', channel: 0, note: 50, velocity: 100 } }],
                out,
                transport
            );
            expect(out.find(isNoteOn)?.kind.note).toBe(50);
        });
    });
});
