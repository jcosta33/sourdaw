import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { generateMentorLessons } from './generateLessons';

describe('generateMentorLessons', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('uses the injected analyzeMix collaborator', () => {
        const analyzeMix = vi.fn().mockReturnValue({
            frequencyProfile: { bass: 0, mid: 0, treble: 0 },
            dynamicRange: 10,
        });
        injectDependencies(generateMentorLessons, { analyzeMix });

        generateMentorLessons();

        expect(analyzeMix).toHaveBeenCalled();
    });
});
