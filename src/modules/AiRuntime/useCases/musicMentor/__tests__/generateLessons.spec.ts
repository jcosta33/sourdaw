import { describe, it, expect, vi, beforeEach } from 'vitest';

import { generateMentorLessons } from '../generateLessons';

vi.mock('#/modules/AudioAnalysis/useCases', () => ({
    analyzeMixFromTrackLayout: vi.fn().mockReturnValue({
        frequencyProfile: { bass: 0, mid: 0, treble: 0 },
        dynamicRange: 10,
    }),
}));

vi.mock('#/modules/Arrangement/stores', () => ({
    trackStore: { value: { tracks: [] } },
}));

describe('generateMentorLessons', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('uses the injected analyzeMix collaborator', async () => {
        const { analyzeMixFromTrackLayout } = await import('#/modules/AudioAnalysis/useCases');

        generateMentorLessons();

        expect(analyzeMixFromTrackLayout).toHaveBeenCalled();
    });
});
