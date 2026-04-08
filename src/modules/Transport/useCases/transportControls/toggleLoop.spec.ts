import { describe, it, expect, vi } from 'vitest';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { toggleLoop } from './toggleLoop';
import { getTransportState, updateTransportState } from '#/modules/Transport/repositories/transport';
import { defaultTransportState } from '#/modules/Transport/models/TransportState';

describe('toggleLoop', () => {
    it('should flip isLooping when transport state exists', () => {
        const getState = vi.fn(() => ({ ...defaultTransportState, isLooping: false }));
        const update = vi.fn();
        injectDependencies(toggleLoop, { getTransportState: getState, updateTransportState: update });

        toggleLoop();

        expect(update).toHaveBeenCalledWith({ isLooping: true });
    });

    it('should not update when transport state is missing', () => {
        const getState = vi.fn(() => null);
        const update = vi.fn();
        injectDependencies(toggleLoop, { getTransportState: getState, updateTransportState: update });

        toggleLoop();

        expect(update).not.toHaveBeenCalled();
    });
});
