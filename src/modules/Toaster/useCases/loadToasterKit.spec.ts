import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { getToasterControls } from './loadToasterKit';

describe('getToasterControls', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('returns null when there is no toaster track', () => {
        injectDependencies(getToasterControls, {
            getAllTracks: () => [],
            getTrackStrip: vi.fn(),
        });

        expect(getToasterControls()).toBeNull();
    });
});
