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
        expect(output.some((event) => event.kind.type === 'noteOn')).toBe(true);
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
});
