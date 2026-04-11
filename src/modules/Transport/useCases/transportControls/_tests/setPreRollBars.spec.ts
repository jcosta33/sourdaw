import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setPreRollBars } from '../setPreRollBars';
import { defaultTransportState } from '#/modules/Transport/models/TransportState';
import { getTransportState } from '#/modules/Transport/repositories/transport/getTransportState';
import { updateTransportState } from '#/modules/Transport/repositories/transport/updateTransportState';

vi.mock('#/modules/Transport/repositories/transport/getTransportState', () => ({
    getTransportState: vi.fn(),
}));
vi.mock('#/modules/Transport/repositories/transport/updateTransportState', () => ({
    updateTransportState: vi.fn(),
}));

describe('setPreRollBars', () => {
    beforeEach(() => {
        vi.mocked(getTransportState).mockClear();
        vi.mocked(updateTransportState).mockClear();
    });

    it('should clamp pre-roll bars between 1 and 8', () => {
        const update = vi.fn();
        vi.mocked(getTransportState).mockReturnValue({ ...defaultTransportState });
        vi.mocked(updateTransportState).mockImplementation(update);

        setPreRollBars(20);

        expect(update).toHaveBeenCalledWith({ preRollBars: 8 });
    });

    it('should not update when transport state is missing', () => {
        const update = vi.fn();
        vi.mocked(getTransportState).mockReturnValue(null as any);
        vi.mocked(updateTransportState).mockImplementation(update);

        setPreRollBars(2);

        expect(update).not.toHaveBeenCalled();
    });
});
