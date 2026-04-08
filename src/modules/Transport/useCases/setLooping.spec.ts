import { describe, it, expect, vi } from 'vitest';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { disableLooping } from './setLooping';
import { defaultTransportState } from '../models/TransportState';

describe('disableLooping', () => {
    it('should set isLooping to false when transport state exists', () => {
        const update = vi.fn();
        injectDependencies(disableLooping, {
            getTransportState: vi.fn(() => ({ ...defaultTransportState, isLooping: true })),
            updateTransportState: update,
        });

        disableLooping();

        expect(update).toHaveBeenCalledWith({ isLooping: false });
    });

    it('should not update when transport state is missing', () => {
        const update = vi.fn();
        injectDependencies(disableLooping, {
            getTransportState: vi.fn(() => null),
            updateTransportState: update,
        });

        disableLooping();

        expect(update).not.toHaveBeenCalled();
    });
});
