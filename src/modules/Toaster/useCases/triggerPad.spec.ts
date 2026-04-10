import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { triggerToasterPad } from './triggerPad';

describe('triggerToasterPad', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('does not touch the strip when no toaster track exists', () => {
        const ensureTrackStrip = vi.fn();
        injectDependencies(triggerToasterPad, {
            getAllTracks: () => [],
            ensureTrackStrip,
        });

        triggerToasterPad(0, 100);

        expect(ensureTrackStrip).not.toHaveBeenCalled();
    });
});
