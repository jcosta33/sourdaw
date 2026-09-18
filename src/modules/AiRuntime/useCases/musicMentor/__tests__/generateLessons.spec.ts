import { describe, it, expect, vi, beforeEach } from 'vitest';

import { trackStore } from '#/modules/Arrangement/stores';

import { generateMentorLessons } from '../generateLessons';

const mocks = vi.hoisted(() => ({
    analyzeCurrentMix: vi.fn<() => unknown>(() => ({ status: 'unavailable', reason: 'no-program-audio' })),
}));

vi.mock('#/modules/AudioAnalysis/useCases', () => ({
    analyzeCurrentMix: mocks.analyzeCurrentMix,
}));

vi.mock('#/modules/Arrangement/stores', () => ({
    trackStore: { value: { tracks: [] } },
}));

describe('generateMentorLessons', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        (trackStore as { value: unknown }).value = { tracks: [] };
    });

    it('uses the injected analyzeCurrentMix collaborator', async () => {
        const { analyzeCurrentMix } = await import('#/modules/AudioAnalysis/useCases');

        generateMentorLessons();

        expect(analyzeCurrentMix).toHaveBeenCalled();
    });

    it('emits no sound-based lessons when no program audio was available', () => {
        mocks.analyzeCurrentMix.mockReturnValue({ status: 'unavailable', reason: 'no-program-audio' });

        const lessons = generateMentorLessons();

        expect(lessons.map((lesson) => lesson.category)).not.toContain('frequency-balance');
        expect(lessons.map((lesson) => lesson.category)).not.toContain('dynamics');
    });

    it('emits sound-based lessons only from a measured analysis', () => {
        // The layout cannot produce this number: the measurement came from
        // program audio that reads as heavily compressed.
        mocks.analyzeCurrentMix.mockReturnValue({
            status: 'measured',
            source: 'program-audio',
            measuredAt: 1,
            analysis: {
                rmsDb: -10,
                peakDb: -8,
                lufs: -10,
                frequencyProfile: {
                    sub: 0.1,
                    bass: 0.1,
                    'low-mid': 0.1,
                    mid: 0.1,
                    'high-mid': 0.1,
                    presence: 0.1,
                    air: 0.1,
                },
                stereoWidth: 0,
                dynamicRange: 3,
                crestFactor: 2,
            },
        });
        (trackStore as { value: unknown }).value = { tracks: [{ id: 't1' }] };

        const lessons = generateMentorLessons();

        expect(lessons.some((lesson) => lesson.category === 'dynamics')).toBe(true);
    });
});
