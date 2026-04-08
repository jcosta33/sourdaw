import { describe, it, expect, vi } from 'vitest';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { setLoopRegion } from './setLoopRegion';
import { defaultTransportState } from '#/modules/Transport/models/TransportState';

describe('setLoopRegion', () => {
    it('should set loop bounds and enable looping', () => {
        const update = vi.fn();
        injectDependencies(setLoopRegion, {
            getTransportState: vi.fn(() => ({ ...defaultTransportState })),
            updateTransportState: update,
        });

        setLoopRegion(4, 16);

        expect(update).toHaveBeenCalledWith({ loopStart: 4, loopEnd: 16, isLooping: true });
    });

    it('should not update when transport state is missing', () => {
        const update = vi.fn();
        injectDependencies(setLoopRegion, {
            getTransportState: vi.fn(() => null),
            updateTransportState: update,
        });

        setLoopRegion(0, 8);

        expect(update).not.toHaveBeenCalled();
    });
});
