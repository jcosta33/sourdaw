import { describe, it, expect, vi } from 'vitest';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { toggleCountIn } from './toggleCountIn';
import { defaultTransportState } from '#/modules/Transport/models/TransportState';

describe('toggleCountIn', () => {
    it('should flip countInEnabled when transport state exists', () => {
        const update = vi.fn();
        injectDependencies(toggleCountIn, {
            getTransportState: vi.fn(() => ({ ...defaultTransportState, countInEnabled: false })),
            updateTransportState: update,
        });

        toggleCountIn();

        expect(update).toHaveBeenCalledWith({ countInEnabled: true });
    });

    it('should not update when transport state is missing', () => {
        const update = vi.fn();
        injectDependencies(toggleCountIn, {
            getTransportState: vi.fn(() => null),
            updateTransportState: update,
        });

        toggleCountIn();

        expect(update).not.toHaveBeenCalled();
    });
});
