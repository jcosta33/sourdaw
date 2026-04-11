import { describe, it, expect, vi, beforeEach } from 'vitest';
import { toggleCountIn } from '../toggleCountIn';
import { defaultTransportState } from '#/modules/Transport/models/TransportState';
import { getTransportState } from '#/modules/Transport/repositories/transport/getTransportState';
import { updateTransportState } from '#/modules/Transport/repositories/transport/updateTransportState';

vi.mock('#/modules/Transport/repositories/transport/getTransportState', () => ({
    getTransportState: vi.fn(),
}));
vi.mock('#/modules/Transport/repositories/transport/updateTransportState', () => ({
    updateTransportState: vi.fn(),
}));

describe('toggleCountIn', () => {
    beforeEach(() => {
        vi.mocked(getTransportState).mockClear();
        vi.mocked(updateTransportState).mockClear();
    });

    it('should flip countInEnabled when transport state exists', () => {
        const update = vi.fn();
        vi.mocked(getTransportState).mockReturnValue({ ...defaultTransportState, countInEnabled: false });
        vi.mocked(updateTransportState).mockImplementation(update);

        toggleCountIn();

        expect(update).toHaveBeenCalledWith({ countInEnabled: true });
    });

    it('should not update when transport state is missing', () => {
        const update = vi.fn();
        vi.mocked(getTransportState).mockReturnValue(null as any);
        vi.mocked(updateTransportState).mockImplementation(update);

        toggleCountIn();

        expect(update).not.toHaveBeenCalled();
    });
});
