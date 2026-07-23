import { describe, it, expect } from 'vitest';

import { EuclideanGenerator } from '../EuclideanGenerator';

import type { MidiEvent, TransportInfo } from '../../../models/MidiEvent';

describe('EuclideanGenerator', () => {
    it('constructs with default pattern (5 hits, 8 steps)', () => {
        const gen = new EuclideanGenerator('test-1');
        expect(gen.getPattern()).toHaveLength(8);
        expect(gen.getPattern().filter(Boolean).length).toBe(5);
    });

    it('generates correct pattern for 3 hits 8 steps', () => {
        const gen = new EuclideanGenerator('test-2');
        gen.setParam('hits', 3);
        gen.setParam('steps', 8);
        const pattern = gen.getPattern();
        expect(pattern).toHaveLength(8);
        expect(pattern.filter(Boolean).length).toBe(3);
    });

    it('generates all-true when hits >= steps', () => {
        const gen = new EuclideanGenerator('test-3');
        gen.setParam('hits', 8);
        gen.setParam('steps', 4);
        expect(gen.getPattern().every((h) => h)).toBe(true);
    });

    it('generates all-false when hits = 0', () => {
        const gen = new EuclideanGenerator('test-4');
        gen.setParam('hits', 0);
        expect(gen.getPattern().every((h) => !h)).toBe(true);
    });

    it('rotation shifts the pattern', () => {
        const gen_a = new EuclideanGenerator('a');
        gen_a.setParam('hits', 3);
        gen_a.setParam('steps', 8);
        const gen_b = new EuclideanGenerator('b');
        gen_b.setParam('hits', 3);
        gen_b.setParam('steps', 8);
        gen_b.setParam('rotation', 1);
        expect(gen_a.getPattern()).not.toEqual(gen_b.getPattern());
    });

    it('clamps hits', () => {
        const gen = new EuclideanGenerator('test-5');
        gen.setParam('hits', 100);
        expect(gen.getPattern().filter(Boolean).length).toBeLessThanOrEqual(32);
        gen.setParam('hits', -5);
        expect(gen.getPattern().every((h) => !h)).toBe(true);
    });

    it('clamps steps to minimum 1', () => {
        const gen = new EuclideanGenerator('test-6');
        gen.setParam('steps', 0);
        gen.setParam('hits', 1);
        expect(gen.getPattern().length).toBeGreaterThanOrEqual(1);
    });

    it('reset clears state', () => {
        const gen = new EuclideanGenerator('test-7');
        gen.reset();
        expect(gen.getCurrentStep()).toBe(0);
    });

    it('setParam accepts all known params without crash', () => {
        const gen = new EuclideanGenerator('test-8');
        gen.setParam('hits', 4);
        gen.setParam('steps', 6);
        gen.setParam('rotation', 2);
        gen.setParam('rate_denom', 8);
        gen.setParam('gate', 0.5);
        gen.setParam('note', 72);
        gen.setParam('velocity', 80);
        expect(gen.getPattern()).toHaveLength(6);
    });

    it('describes generated note duration before the release crosses a block boundary', () => {
        const gen = new EuclideanGenerator('duration');
        gen.setParam('hits', 8);
        const output: MidiEvent[] = [];
        const transport: TransportInfo = {
            sampleRate: 48_000,
            bpm: 120,
            blockStartSamples: 0,
            blockEndSamples: 6_001,
            ppqPosition: 0,
            isPlaying: true,
            barIndex: 0,
            beatInBar: 0,
            timeSigNum: 4,
            timeSigDen: 4,
            loopEnabled: false,
            loopStartPpq: 0,
            loopEndPpq: 0,
        };

        gen.processMidi([], output, transport);

        const noteOn = output.find((event) => event.kind.type === 'noteOn');
        expect(noteOn?.durationSamples).toBe(3_000);
    });
});
