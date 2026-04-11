import { describe, it, expect, vi } from 'vitest';
import { type MixAnalysis } from '../../models/MixComparisonTypes';

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

vi.mock('./analyzeMix/createReferenceAnalysis', () => ({
    createReferenceAnalysis: vi.fn(() => sampleAnalysis),
}));

vi.mock('./analyzeMix/analyzeMix', () => ({
    analyzeMix: vi.fn(() => sampleAnalysis),
}));

import { compareMixes, compareToReference } from './compareMixes';

describe('compareMixes', () => {
    it('produces a high score when current matches reference', () => {
        const result = compareMixes(sampleAnalysis, sampleAnalysis);
        expect(result.overallScore).toBeGreaterThanOrEqual(80);
        expect(result.suggestions).toEqual([]);
    });

    it('flags loudness mismatch with a suggestion', () => {
        const louder = { ...sampleAnalysis, lufs: -8 };
        const result = compareMixes(sampleAnalysis, louder);
        expect(result.suggestions.some((s) => s.category === 'loudness')).toBe(true);
    });

    it('compareToReference reads its inputs from analyzeMix / createReferenceAnalysis', () => {
        const result = compareToReference();
        expect(result).toBeDefined();
        expect(result.overallScore).toBeGreaterThanOrEqual(0);
    });
});
