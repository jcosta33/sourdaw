import { describe, expect, it } from 'vitest';

import {
    DEFAULT_BAND,
    DEFAULT_PATCH,
    type BacteriaDistortionMode,
    type BacteriaFilterMode,
    type BacteriaCrossoverMode,
    type BacteriaRoutingMode,
} from '../BacteriaPatch';

describe('BacteriaPatch — DEFAULT_BAND', () => {
    it('has sensible initial values', () => {
        expect(DEFAULT_BAND.enabled).toBe(true);
        expect(DEFAULT_BAND.solo).toBe(false);
        expect(DEFAULT_BAND.mute).toBe(false);
        expect(DEFAULT_BAND.gain).toBe(0);
        expect(DEFAULT_BAND.oversampling).toBeGreaterThanOrEqual(1);
    });

    it('starts with distortion off but configured', () => {
        expect(DEFAULT_BAND.distortionEnabled).toBe(false);
        expect(typeof DEFAULT_BAND.distortionMode).toBe('string');
        expect(DEFAULT_BAND.drive).toBeGreaterThanOrEqual(0);
    });

    it('starts with filter off but configured', () => {
        expect(DEFAULT_BAND.filterEnabled).toBe(false);
        expect(DEFAULT_BAND.filterCutoff).toBeGreaterThan(20);
        expect(DEFAULT_BAND.filterResonance).toBeGreaterThanOrEqual(0);
    });
});

describe('BacteriaPatch — DEFAULT_PATCH', () => {
    it('has the expected name and mix settings', () => {
        expect(DEFAULT_PATCH.name).toBe('Init');
        expect(DEFAULT_PATCH.mix).toBe(1);
        expect(DEFAULT_PATCH.bypass).toBe(false);
    });

    it('has 6 bands by default', () => {
        expect(DEFAULT_PATCH.bands).toHaveLength(6);
    });

    it('uses lr4 crossover mode by default', () => {
        expect(DEFAULT_PATCH.crossoverMode).toBe('lr4');
    });

    it('has 8 macros initialized to 0.5', () => {
        for (let i = 1; i <= 8; i++) {
            const key = `macro${i}` as keyof typeof DEFAULT_PATCH;
            expect(DEFAULT_PATCH[key]).toBe(0.5);
        }
    });

    it('has 4 snapshots A-D with empty param values', () => {
        expect(DEFAULT_PATCH.snapshots).toHaveLength(4);
        for (const snap of DEFAULT_PATCH.snapshots) {
            expect(snap.paramValues).toEqual({});
        }
    });

    it('has morph X/Y at center', () => {
        expect(DEFAULT_PATCH.morphX).toBe(0.5);
        expect(DEFAULT_PATCH.morphY).toBe(0.5);
    });

    it('has empty mod assignments by default', () => {
        expect(DEFAULT_PATCH.modAssignments).toEqual([]);
    });

    it('has crossover frequencies in ascending order', () => {
        const freqs = [
            DEFAULT_PATCH.crossoverFreq1,
            DEFAULT_PATCH.crossoverFreq2,
            DEFAULT_PATCH.crossoverFreq3,
            DEFAULT_PATCH.crossoverFreq4,
            DEFAULT_PATCH.crossoverFreq5,
        ];
        for (let i = 1; i < freqs.length; i++) {
            expect(freqs[i]).toBeGreaterThan(freqs[i - 1]!);
        }
    });
});

describe('BacteriaPatch — type unions', () => {
    it('distortion modes include the expected set', () => {
        const modes: BacteriaDistortionMode[] = [
            'soft-clip',
            'hard-clip',
            'foldback',
            'wavefold',
            'bitcrush',
            'tube',
            'breakdown',
            'smudge',
            'custom',
        ];
        expect(modes).toHaveLength(9);
    });

    it('filter modes include the expected set', () => {
        const modes: BacteriaFilterMode[] = ['lowpass', 'highpass', 'bandpass', 'notch', 'formant', 'comb'];
        expect(modes).toHaveLength(6);
    });

    it('crossover modes are lr4 and linear-phase', () => {
        const modes: BacteriaCrossoverMode[] = ['lr4', 'linear-phase'];
        expect(modes).toHaveLength(2);
    });

    it('routing modes are serial, parallel, and mid-side', () => {
        const modes: BacteriaRoutingMode[] = ['serial', 'parallel', 'mid-side'];
        expect(modes).toHaveLength(3);
    });
});
