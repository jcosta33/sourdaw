import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type MixAnalysis, type MixComparisonResult } from '../../../models/MixComparisonTypes';
import { compareToReference } from '../compareToReference';

const mocks = vi.hoisted(() => ({
    analyzeMix: vi.fn<() => MixAnalysis>(),
    compareMixes: vi.fn<(reference: MixAnalysis, current: MixAnalysis) => MixComparisonResult>(),
    createReferenceAnalysis: vi.fn<() => MixAnalysis>(),
}));

vi.mock('../analyzeMix/analyzeMix', () => ({
    analyzeMix: mocks.analyzeMix,
}));

vi.mock('../analyzeMix/createReferenceAnalysis', () => ({
    createReferenceAnalysis: mocks.createReferenceAnalysis,
}));

vi.mock('../compareMixes', () => ({
    compareMixes: mocks.compareMixes,
}));

const currentAnalysis: MixAnalysis = {
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

const referenceAnalysis: MixAnalysis = {
    ...currentAnalysis,
    rmsDb: -12,
    peakDb: -1,
    stereoWidth: 0.65,
    dynamicRange: 8,
    crestFactor: 5,
};

const expectedResult: MixComparisonResult = {
    overallScore: 88,
    scores: {
        frequency: 90,
        dynamics: 80,
        loudness: 100,
        stereoWidth: 85,
    },
    suggestions: [],
    referenceAnalysis,
    currentAnalysis,
    analyzedAt: '2026-01-01T00:00:00.000Z',
};

describe('compareToReference', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should analyze the current mix, create a reference, and delegate comparison', () => {
        mocks.analyzeMix.mockReturnValue(currentAnalysis);
        mocks.createReferenceAnalysis.mockReturnValue(referenceAnalysis);
        mocks.compareMixes.mockReturnValue(expectedResult);

        const result = compareToReference();

        expect(mocks.analyzeMix).toHaveBeenCalledTimes(1);
        expect(mocks.createReferenceAnalysis).toHaveBeenCalledTimes(1);
        expect(mocks.compareMixes).toHaveBeenCalledWith(referenceAnalysis, currentAnalysis);
        expect(result).toBe(expectedResult);
    });
});
