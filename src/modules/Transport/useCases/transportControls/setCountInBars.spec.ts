import { describe, it, expect, vi } from 'vitest';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { setCountInBars } from './setCountInBars';
import { defaultTransportState } from '#/modules/Transport/models/TransportState';

describe('setCountInBars', () => {
    it('should clamp count-in bars between 1 and 8', () => {
        const update = vi.fn();
        injectDependencies(setCountInBars, {
            getTransportState: vi.fn(() => ({ ...defaultTransportState })),
            updateTransportState: update,
        });

        setCountInBars(0);

        expect(update).toHaveBeenCalledWith({ countInBars: 1 });
    });

    it('should not update when transport state is missing', () => {
        const update = vi.fn();
        injectDependencies(setCountInBars, {
            getTransportState: vi.fn(() => null),
            updateTransportState: update,
        });

        setCountInBars(2);

        expect(update).not.toHaveBeenCalled();
    });
});
