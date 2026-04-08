import { describe, it, expect, vi } from 'vitest';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { toggleOverdub } from './toggleOverdub';
import { defaultTransportState } from '#/modules/Transport/models/TransportState';

describe('toggleOverdub', () => {
    it('should flip overdubEnabled when transport state exists', () => {
        const update = vi.fn();
        injectDependencies(toggleOverdub, {
            getTransportState: vi.fn(() => ({ ...defaultTransportState, overdubEnabled: false })),
            updateTransportState: update,
        });

        toggleOverdub();

        expect(update).toHaveBeenCalledWith({ overdubEnabled: true });
    });

    it('should not update when transport state is missing', () => {
        const update = vi.fn();
        injectDependencies(toggleOverdub, {
            getTransportState: vi.fn(() => null),
            updateTransportState: update,
        });

        toggleOverdub();

        expect(update).not.toHaveBeenCalled();
    });
});
