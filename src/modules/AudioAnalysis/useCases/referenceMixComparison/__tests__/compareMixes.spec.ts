import { describe, it, expect, vi } from 'vitest';

import { type MixAnalysis } from '../../../models/MixComparisonTypes';

const sampleAnalysis: MixAnalysis = {
    rmsDb: -18,
    peakDb: -6,
    lufs: -14,
    frequencyProfile: {
        sub: 0.3,
        bass: 0.5,
        'low-mid': 0.6,
        mid: 0.7,
        'high-mid': 0.6,
        presence: 0.5,
        air: 0.3,
    },
    stereoWidth: 0.6,
    dynamicRange: 12,
    crestFactor: 12,
};

vi.mock('../analyzeMix/createReferenceAnalysis', () => ({
    createReferenceAnalysis: vi.fn(() => sampleAnalysis),
}));

vi.mock('../analyzeMix/analyzeMix', () => ({
    analyzeMix: vi.fn(() => sampleAnalysis),
}));

import { compareMixes, compareToReference } from '../compareMixes';

describe('compareMixes', () => {
    it('should produce a high score when current matches reference', () => {
        const result = compareMixes(sampleAnalysis, sampleAnalysis);
        expect(result.overallScore).toBeGreaterThanOrEqual(80);
        expect(result.suggestions).toEqual([]);
    });

    it('should flag loudness mismatch with a suggestion', () => {
        const louder = { ...sampleAnalysis, lufs: -8 };
        const result = compareMixes(sampleAnalysis, louder);
        expect(result.suggestions.some((state) => state.category === 'loudness')).toBe(true);
    });

    it('should flag frequency band mismatch when profile differs enough', () => {
        const current = {
            ...sampleAnalysis,
            frequencyProfile: { ...sampleAnalysis.frequencyProfile, bass: 0.75 },
        };
        const result = compareMixes(sampleAnalysis, current);
        expect(result.suggestions.some((state) => state.category === 'frequency' && state.target === 'bass')).toBe(
            true
        );
    });

    it('should flag dynamics mismatch when dynamic range differs enough', () => {
        const current = { ...sampleAnalysis, dynamicRange: 5 };
        const result = compareMixes(sampleAnalysis, current);
        expect(result.suggestions.some((state) => state.category === 'dynamics')).toBe(true);
    });

    it('should flag stereo width mismatch when width differs enough', () => {
        const current = { ...sampleAnalysis, stereoWidth: 0.95 };
        const result = compareMixes(sampleAnalysis, current);
        expect(result.suggestions.some((state) => state.category === 'stereo')).toBe(true);
    });

    it('should compareToReference using analyzeMix and createReferenceAnalysis', () => {
        const result = compareToReference();
        expect(result).toBeDefined();
        expect(result.overallScore).toBeGreaterThanOrEqual(0);
    });
});
