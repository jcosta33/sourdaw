import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type MixAnalysis, type MixComparisonResult } from '../../../models/MixComparisonTypes';
import { compareToReference } from '../compareToReference';

const mocks = vi.hoisted(() => ({
    analyzeMix: vi.fn(),
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

const measured = {
    status: 'measured' as const,
    analysis: currentAnalysis,
    source: 'program-audio' as const,
    measuredAt: 1,
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

    it('compares the measured current mix against the specified reference target', () => {
        mocks.analyzeMix.mockReturnValue(measured);
        mocks.createReferenceAnalysis.mockReturnValue(referenceAnalysis);
        mocks.compareMixes.mockReturnValue(expectedResult);

        const programAudio = [{} as AudioBuffer];
        const result = compareToReference(programAudio);

        expect(mocks.analyzeMix).toHaveBeenCalledWith(programAudio);
        expect(mocks.createReferenceAnalysis).toHaveBeenCalledTimes(1);
        expect(mocks.compareMixes).toHaveBeenCalledWith(referenceAnalysis, currentAnalysis);
        expect(result).toEqual({ ...expectedResult, referenceKind: 'specified-target' });
    });

    it('reports unavailable instead of a fabricated score when there is no program audio', () => {
        mocks.analyzeMix.mockReturnValue({ status: 'unavailable', reason: 'no-program-audio' });

        const result = compareToReference();

        expect(result).toEqual({ status: 'unavailable', reason: 'no-program-audio' });
        expect(mocks.compareMixes).not.toHaveBeenCalled();
        expect(mocks.createReferenceAnalysis).not.toHaveBeenCalled();
    });

    it('reports unavailable instead of a score for a silent source', () => {
        mocks.analyzeMix.mockReturnValue({ status: 'unavailable', reason: 'silent-program-audio' });

        expect(compareToReference()).toEqual({ status: 'unavailable', reason: 'silent-program-audio' });
        expect(mocks.compareMixes).not.toHaveBeenCalled();
    });
});
