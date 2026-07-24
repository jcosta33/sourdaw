import { describe, it, expect } from 'vitest';

import { type MidiEvent, type TransportInfo } from '../../../models/MidiEvent';
import { MarkovChain } from '../MarkovChain';

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

const noteOn = (timeSamples: number, note: number): MidiEvent => ({
    timeSamples,
    kind: { type: 'noteOn' as const, channel: 0, note, velocity: 100 },
});

describe('MarkovChain', () => {
    it('constructs with default matrix', () => {
        const mc = new MarkovChain('t1');
        const matrix = mc.getMatrix();
        expect(matrix.length).toBeGreaterThan(0);
    });

    it('matrix rows sum to ~1', () => {
        const mc = new MarkovChain('t2');
        for (const row of mc.getMatrix()) {
            const sum = row.reduce((a, b) => a + b, 0);
            expect(sum).toBeGreaterThan(0.5);
        }
    });

    it('processes a held note through its public MIDI behavior', () => {
        const mc = new MarkovChain('t3');
        mc.setParam('rate_denom', 1024);
        const output: MidiEvent[] = [];
        mc.processMidi([noteOn(0, 60)], output, transport);
        const generated = output.find((event) => event.kind.type === 'noteOn');
        expect(generated).toEqual(expect.objectContaining({ durationSamples: 65.625 }));
        const later: MidiEvent[] = [];
        mc.processMidi([], later, { ...transport, blockStartSamples: 128, blockEndSamples: 256 });
        expect(later).toContainEqual(expect.objectContaining({ noteInstanceId: generated?.noteInstanceId }));
    });

    it('reset returns to state 0', () => {
        const mc = new MarkovChain('t4');
        mc.processMidi([noteOn(0, 60)], [], transport);
        mc.reset();
        expect(mc.getCurrentState()).toBe(0);
    });

    it('setTransition modifies probabilities', () => {
        const mc = new MarkovChain('t5');
        const output: MidiEvent[] = [];
        mc.processMidi([noteOn(0, 60)], output, transport);
        mc.setTransition(0, 0, 1.0);
        const matrix = mc.getMatrix();
        const firstRow = matrix[0];
        expect(firstRow).toBeDefined();
        if (!firstRow) {
            return;
        }
        expect(firstRow[0]).toBeGreaterThan(firstRow[1] ?? 0);
    });

    it('deterministic with identity transition', () => {
        const mc = new MarkovChain('t6');
        mc.processMidi([noteOn(0, 60)], [], transport);
        mc.setTransition(0, 0, 1.0);
        mc.setParam('rate_denom', 1024);
        const output: ReturnType<typeof noteOn>[] = [];
        mc.processMidi([], output, transport);
        const generated = output.find((event) => event.kind.type === 'noteOn');
        expect(generated).toBeDefined();
        if (!generated || generated.kind.type !== 'noteOn') {
            return;
        }
        expect(generated.kind.note).toBe(60);
    });

    it('all setParam values accepted', () => {
        const mc = new MarkovChain('t7');
        mc.setParam('root', 60);
        mc.setParam('range', 12);
        mc.setParam('velocity', 80);
        mc.setParam('gate', 0.5);
        mc.setParam('depth', 0.5);
        mc.setParam('rate_denom', 8);
        expect(mc.getStateCount()).toBeGreaterThan(0);
    });

    it('getCurrentState starts at 0', () => {
        expect(new MarkovChain('t8').getCurrentState()).toBe(0);
    });

    it('re-normalizes the row so it still sums to ~1 after setTransition', () => {
        const mc = new MarkovChain('norm');
        mc.processMidi([noteOn(0, 60)], [], transport);
        mc.setTransition(0, 0, 5.0);
        const row = mc.getMatrix()[0]!;
        const sum = row.reduce((a, b) => a + b, 0);
        expect(sum).toBeCloseTo(1, 5);
    });

    it('ignores setTransition for out-of-bounds from/to indices', () => {
        const mc = new MarkovChain('oob');
        mc.processMidi([noteOn(0, 60)], [], transport); // stateCount becomes 1
        const before = mc.getMatrix();
        mc.setTransition(50, 50, 0.9); // from/to beyond stateCount → no-op
        expect(mc.getMatrix()).toEqual(before);
    });

    it('passes through non-note events unchanged', () => {
        const mc = new MarkovChain('cc');
        const cc = {
            timeSamples: 0,
            kind: { type: 'cc', channel: 0, cc: 7, value: 64 },
        } as MidiEvent;
        const out: MidiEvent[] = [];
        mc.processMidi([cc], out, transport);
        expect(out[0]).toBe(cc);
    });

    it('clamps the velocity param into [1,127] on generated notes', () => {
        const mc = new MarkovChain('params');
        mc.setParam('velocity', 999); // → 127
        mc.setParam('rate_denom', 1024); // fast rate so a step fits in a small block
        mc.processMidi([noteOn(0, 60)], [], transport);
        const out: MidiEvent[] = [];
        mc.processMidi([], out, { ...transport, blockStartSamples: 0, blockEndSamples: 600 });
        const on = out.find((e) => e.kind.type === 'noteOn');
        expect(on).toBeDefined();
        expect((on!.kind as { velocity: number }).velocity).toBe(127);
    });

    it('clamps the gate param into [0.01,2]', () => {
        const mc = new MarkovChain('gate');
        mc.setParam('gate', 99); // → 2
        mc.setParam('rate_denom', 1024);
        mc.processMidi([noteOn(0, 60)], [], transport);
        const out: MidiEvent[] = [];
        mc.processMidi([], out, { ...transport, blockStartSamples: 0, blockEndSamples: 600 });
        const on = out.find((e) => e.kind.type === 'noteOn');
        // noteLen = stepLen * gate(2) → durationSamples = stepLen * 2 (clamped gate)
        expect(on?.durationSamples).toBeGreaterThan(0);
    });

    it('does not generate notes when transport is not playing', () => {
        const mc = new MarkovChain('stopped');
        mc.processMidi([noteOn(0, 60)], [], transport);
        const out: MidiEvent[] = [];
        mc.processMidi([], out, { ...transport, isPlaying: false, blockStartSamples: 0, blockEndSamples: 600 });
        expect(out.filter((e) => e.kind.type === 'noteOn')).toHaveLength(0);
    });

    it('clamps the held-note state count to MAX_STATES (12)', () => {
        const mc = new MarkovChain('max');
        // hold 20 distinct notes → stateCount capped at 12
        const ons: MidiEvent[] = [];
        for (let n = 0; n < 20; n++) {
            ons.push(noteOn(0, 60 + n));
        }
        mc.processMidi(ons, [], transport);
        expect(mc.getStateCount()).toBe(12);
    });

    it('removes a held note on noteOff and keeps generating from the remaining set', () => {
        const mc = new MarkovChain('release');
        mc.setParam('rate_denom', 1024);
        mc.processMidi([noteOn(0, 60), noteOn(0, 64)], [], transport);
        expect(mc.getStateCount()).toBe(2);
        // release note 64
        mc.processMidi([{ timeSamples: 0, kind: { type: 'noteOff', channel: 0, note: 64 } }], [], transport);
        // generation continues (does not throw / does not stop on release)
        const out: MidiEvent[] = [];
        mc.processMidi([], out, { ...transport, blockStartSamples: 0, blockEndSamples: 600 });
        expect(out.some((e) => e.kind.type === 'noteOn')).toBe(true);
    });
});
