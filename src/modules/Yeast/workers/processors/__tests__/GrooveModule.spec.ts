import { describe, it, expect } from 'vitest';

import { type MidiEvent, type TransportInfo } from '../../../models/MidiEvent';
import { GrooveModule } from '../GrooveModule';

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

describe('GrooveModule', () => {
    it('constructs with the provided id and processor name', () => {
        const g = new GrooveModule('t1');
        expect(g.id).toBe('t1');
        expect(g.name).toBe('Groove');
    });

    it('passes through note on events', () => {
        const g = new GrooveModule('t2');
        const out: MidiEvent[] = [];
        g.processMidi([note_on(0, 60)], out, transport);
        expect(out.length).toBeGreaterThan(0);
    });

    it('should apply a canonical projected timing and dynamics slot relative to the block musical origin', () => {
        const g = new GrooveModule('t3');
        g.setParam('groove_step_beats', 0.25);
        g.setParam('groove_slot_count', 16);
        g.setParam('groove_timing_1', 0.2);
        g.setParam('groove_dynamics_1', -0.1);
        g.setParam('groove_amount', 0.75);
        const out: MidiEvent[] = [];
        const event = note_on(120_000, 60);
        const blockTransport = { ...transport, ppqPosition: 8.25, blockStartSamples: 120_000 };

        g.processMidi([event], out, blockTransport);

        expect(out).toHaveLength(1);
        expect(out[0]?.timeSamples).toBe(120_900);
        expect(out[0]?.kind).toEqual({ type: 'noteOn', channel: 0, note: 60, velocity: 93 });
        expect(event).toEqual(note_on(120_000, 60));
    });

    it('should clamp projected amount to the 0-1 range', () => {
        const g = new GrooveModule('t4');
        g.setParam('groove_timing_1', 0.12);

        g.setParam('groove_amount', 1.5);
        const overshoot: MidiEvent[] = [];
        g.processMidi([note_on(6000, 60)], overshoot, transport);
        expect(overshoot[0]?.timeSamples).toBe(6720);

        g.setParam('groove_amount', -0.5);
        const undershoot: MidiEvent[] = [];
        g.processMidi([note_on(6000, 60)], undershoot, transport);
        expect(undershoot[0]?.timeSamples).toBe(6000);
    });

    it('should apply the matching canonical timing offset to note off', () => {
        const g = new GrooveModule('t5');
        g.setParam('groove_timing_1', 0.12);
        g.setParam('groove_amount', 1);
        g.processMidi([note_on(6000, 60)], [], transport);

        const out: MidiEvent[] = [];
        g.processMidi([note_off(12_000, 60)], out, transport);

        expect(out[0]?.timeSamples).toBe(12_720);
    });

    it('should project one musical offset independently at each endpoint tempo', () => {
        const groove = new GrooveModule('tempo-map');
        groove.setParam('groove_step_beats', 0.25);
        groove.setParam('groove_slot_count', 16);
        groove.setParam('groove_timing_1', 0.5);
        groove.setParam('groove_amount', 1);
        const noteOn = {
            timeSamples: 6_000,
            timePpq: 0.25,
            tempoBpm: 120,
            kind: { type: 'noteOn' as const, channel: 0, note: 60, velocity: 100 },
        } satisfies MidiEvent;
        const noteOff = {
            timeSamples: 24_000,
            timePpq: 1,
            tempoBpm: 240,
            kind: { type: 'noteOff' as const, channel: 0, note: 60 },
        } satisfies MidiEvent;
        const output: MidiEvent[] = [];

        groove.processMidi([noteOn, noteOff], output, transport);

        expect(output.map((event) => event.timeSamples)).toEqual([9_000, 25_500]);
        expect(output.map((event) => event.timePpq)).toEqual([0.375, 1.125]);
    });

    it('integrates a PPQ shift across an instant tempo change', () => {
        const groove = new GrooveModule('tempo-crossing');
        groove.setParam('groove_step_beats', 0.5);
        groove.setParam('groove_slot_count', 16);
        groove.setParam('groove_timing_8', -0.5);
        groove.setParam('groove_amount', 1);
        const output: MidiEvent[] = [];
        const tempoMapTransport: TransportInfo = {
            ...transport,
            bpm: 120,
            tempoMap: {
                defaultTempo: 60,
                changes: [
                    { beat: 0, tempo: 60, curve: 'instant' },
                    { beat: 4, tempo: 120, curve: 'instant' },
                ],
            },
        };

        groove.processMidi(
            [
                {
                    timeSamples: 192_000,
                    durationSamples: 24_000,
                    durationPpq: 1,
                    timePpq: 4,
                    tempoBpm: 120,
                    kind: { type: 'noteOn', channel: 0, note: 60, velocity: 100 },
                },
            ],
            output,
            tempoMapTransport
        );

        expect(output[0]?.timePpq).toBe(3.75);
        expect(output[0]?.timeSamples).toBe(180_000);
        expect(output[0]?.durationSamples).toBe(30_000);

        groove.processMidi(
            [
                {
                    timeSamples: 216_000,
                    timePpq: 5,
                    tempoBpm: 120,
                    kind: { type: 'noteOff', channel: 0, note: 60 },
                },
            ],
            output,
            tempoMapTransport
        );
        expect(output[1]?.timeSamples).toBe(210_000);
        expect(output[1]!.timeSamples - output[0]!.timeSamples).toBe(output[0]?.durationSamples);
    });

    it('should clear queued note-off timing state on reset', () => {
        const g = new GrooveModule('t5');
        g.setParam('groove_timing_1', 0.12);
        g.setParam('groove_amount', 1);
        g.processMidi([note_on(6000, 60)], [], transport);

        g.reset();

        const out: MidiEvent[] = [];
        g.processMidi([note_off(6000, 60)], out, transport);

        expect(out[0]?.timeSamples).toBe(6000);
    });
});
