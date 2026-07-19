import { describe, it, expect } from 'vitest';

import { type MidiEvent, type TransportInfo } from '../../../models/MidiEvent';
import { GrooveModule } from '../GrooveModule';

const transport: TransportInfo = {
    isPlaying: true,
    ppqPosition: 0,
    blockStartSamples: 0,
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
const noteOn = (timeSamples: number, note: number, velocity = 100): MidiEvent => ({
    timeSamples,
    kind: { type: 'noteOn', channel: 0, note, velocity },
});
const noteOff = (timeSamples: number, note: number): MidiEvent => ({
    timeSamples,
    kind: { type: 'noteOff', channel: 0, note },
});

describe('GrooveModule', () => {
    it('constructs without crash', () => {
        const g = new GrooveModule('t1');
        expect(g).toBeDefined();
    });

    it('passes through note on events', () => {
        const g = new GrooveModule('t2');
        const out: MidiEvent[] = [];
        g.processMidi([noteOn(0, 60)], out, transport);
        expect(out.length).toBeGreaterThan(0);
    });

    it('applies the canonical runtime timing and dynamics projection', () => {
        const g = new GrooveModule('t3');
        g.setParam('groove_amount', 1);
        g.setParam('groove_step_beats', 0.25);
        g.setParam('groove_slot_count', 16);
        g.setParam('groove_timing_1', 0.2);
        g.setParam('groove_dynamics_1', -0.1);
        const out: MidiEvent[] = [];
        g.processMidi([noteOn(6000, 60)], out, transport);

        expect(out[0]).toEqual({
            timeSamples: 7200,
            trackId: undefined,
            kind: { type: 'noteOn', channel: 0, note: 60, velocity: 87 },
        });
    });

    it('setParam amount clamps', () => {
        const g = new GrooveModule('t4');
        g.setParam('groove_amount', 0);
        g.setParam('groove_amount', 1.5);
        g.setParam('groove_amount', -0.5);
    });

    it('reset clears state', () => {
        const g = new GrooveModule('t5');
        g.setParam('groove_amount', 1);
        g.setParam('groove_timing_0', 0.1);
        g.processMidi([noteOn(0, 60)], [], transport);
        g.reset();
        const out: MidiEvent[] = [];
        g.processMidi([noteOff(12000, 60)], out, transport);
        expect(out[0]?.timeSamples).toBe(12000);
    });

    it('selects the same musical slot across tempo transitions using the block origin and PPQ', () => {
        const g = new GrooveModule('tempo-transition');
        g.setParam('groove_amount', 1);
        g.setParam('groove_step_beats', 0.25);
        g.setParam('groove_slot_count', 16);
        g.setParam('groove_timing_1', 0.2);
        g.setParam('groove_dynamics_1', -0.1);

        const blockStart = 2_400_000;
        const at120 = { ...transport, bpm: 120, ppqPosition: 8, blockStartSamples: blockStart };
        const at60 = { ...transport, bpm: 60, ppqPosition: 8, blockStartSamples: blockStart };
        const out120: MidiEvent[] = [];
        const out60: MidiEvent[] = [];
        g.processMidi([noteOn(blockStart + 6000, 60)], out120, at120);
        g.reset();
        g.processMidi([noteOn(blockStart + 12000, 60)], out60, at60);

        expect(out120[0]?.kind).toEqual({ type: 'noteOn', channel: 0, note: 60, velocity: 87 });
        expect(out60[0]?.kind).toEqual(out120[0]?.kind);
        expect((out120[0]!.timeSamples - (blockStart + 6000)) / 24000).toBeCloseTo(0.05, 10);
        expect((out60[0]!.timeSamples - (blockStart + 12000)) / 48000).toBeCloseTo(0.05, 10);
    });

    it('matches overlapping same-pitch note offs to note-on offsets in FIFO order', () => {
        const g = new GrooveModule('overlap');
        g.setParam('groove_amount', 1);
        g.setParam('groove_timing_0', 0.1);
        g.setParam('groove_timing_1', -0.2);
        const out: MidiEvent[] = [];

        g.processMidi([noteOn(0, 60), noteOn(6000, 60), noteOff(12000, 60), noteOff(18000, 60)], out, transport);

        expect(out.map((event) => event.timeSamples)).toEqual([600, 4800, 12600, 16800]);
    });

    it('bounds overlapping same-pitch offset tracking and degrades overflow note offs to no shift', () => {
        const g = new GrooveModule('overflow');
        g.setParam('groove_amount', 1);
        g.setParam('groove_timing_0', 0.1);
        const overlapCount = 33;
        const out: MidiEvent[] = [];
        const noteOns = Array.from({ length: overlapCount }, () => noteOn(0, 60));
        const noteOffs = Array.from({ length: overlapCount }, (_, index) => noteOff(12000 + index * 1000, 60));

        g.processMidi([...noteOns, ...noteOffs], out, transport);

        const shiftedOffTimes = out.slice(overlapCount).map((event) => event.timeSamples);
        expect(shiftedOffTimes.slice(0, 32)).toEqual(Array.from({ length: 32 }, (_, index) => 12600 + index * 1000));
        expect(shiftedOffTimes[32]).toBe(44000);
    });

    it('projects the shared beat offset independently at each endpoint tempo', () => {
        const g = new GrooveModule('tempo-endpoints');
        g.setParam('groove_amount', 1);
        g.setParam('groove_step_beats', 0.5);
        g.setParam('groove_timing_0', 0.5);
        const out: MidiEvent[] = [];

        g.processMidi(
            [
                { ...noteOn(0, 60), timePpq: 0, tempoBpm: 120 },
                { ...noteOff(96_000, 60), timePpq: 4, tempoBpm: 240 },
            ],
            out,
            { ...transport, sampleRate: 48_000, bpm: 120 }
        );

        expect(out.map((event) => event.timeSamples)).toEqual([6_000, 99_000]);
    });

    it('pairs overlapping same-pitch note offs by stable note-instance identity before legacy FIFO order', () => {
        const g = new GrooveModule('identity-overlap');
        g.setParam('groove_amount', 1);
        g.setParam('groove_timing_0', 0.1);
        g.setParam('groove_timing_1', -0.2);
        const out: MidiEvent[] = [];

        g.processMidi(
            [
                { ...noteOn(0, 60), noteInstanceId: 'voice-a' },
                { ...noteOn(6_000, 60), noteInstanceId: 'voice-b' },
                { ...noteOff(12_000, 60), noteInstanceId: 'voice-b' },
                { ...noteOff(18_000, 60), noteInstanceId: 'voice-a' },
            ],
            out,
            transport
        );

        expect(out.map((event) => event.timeSamples)).toEqual([600, 4_800, 10_800, 18_600]);
    });

    it('fails the 2,049th identified note pair closed when the offset table is full', () => {
        const g = new GrooveModule('instance-capacity');
        g.setParam('groove_amount', 1);
        g.setParam('groove_timing_0', 0.5);
        const pairCount = 2_049;
        const out: MidiEvent[] = [];
        const noteOns = Array.from({ length: pairCount }, (_, index) => ({
            ...noteOn(0, 60),
            noteInstanceId: `voice-${index}`,
        }));
        const noteOffs = Array.from({ length: pairCount }, (_, index) => ({
            ...noteOff(1, 60),
            noteInstanceId: `voice-${index}`,
        }));

        g.processMidi([...noteOns, ...noteOffs], out, transport);

        const lastNoteOn = out[pairCount - 1];
        const lastNoteOff = out[out.length - 1];
        expect(lastNoteOn?.timeSamples).toBe(0);
        expect(lastNoteOff?.timeSamples).toBe(1);
    });
});
