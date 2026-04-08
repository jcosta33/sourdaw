import { describe, it, expect, vi } from 'vitest';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { togglePunchEnabled } from './togglePunchEnabled';
import { defaultTransportState } from '#/modules/Transport/models/TransportState';

describe('togglePunchEnabled', () => {
    it('should flip punchInEnabled when transport state exists', () => {
        const update = vi.fn();
        injectDependencies(togglePunchEnabled, {
            getTransportState: vi.fn(() => ({ ...defaultTransportState, punchInEnabled: false })),
            updateTransportState: update,
        });

        togglePunchEnabled();

        expect(update).toHaveBeenCalledWith({ punchInEnabled: true });
    });

    it('should not update when transport state is missing', () => {
        const update = vi.fn();
        injectDependencies(togglePunchEnabled, {
            getTransportState: vi.fn(() => null),
            updateTransportState: update,
        });

        togglePunchEnabled();

        expect(update).not.toHaveBeenCalled();
    });
});
