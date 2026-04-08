import { describe, it, expect, vi } from 'vitest';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { togglePreRoll } from './togglePreRoll';
import { defaultTransportState } from '#/modules/Transport/models/TransportState';

describe('togglePreRoll', () => {
    it('should flip preRollEnabled when transport state exists', () => {
        const update = vi.fn();
        injectDependencies(togglePreRoll, {
            getTransportState: vi.fn(() => ({ ...defaultTransportState, preRollEnabled: false })),
            updateTransportState: update,
        });

        togglePreRoll();

        expect(update).toHaveBeenCalledWith({ preRollEnabled: true });
    });

    it('should not update when transport state is missing', () => {
        const update = vi.fn();
        injectDependencies(togglePreRoll, {
            getTransportState: vi.fn(() => null),
            updateTransportState: update,
        });

        togglePreRoll();

        expect(update).not.toHaveBeenCalled();
    });
});
