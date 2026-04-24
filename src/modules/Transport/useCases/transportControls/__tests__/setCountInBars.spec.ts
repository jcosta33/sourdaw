import { describe, it, expect, vi, beforeEach } from 'vitest';

import { defaultTransportState, type TransportState } from '../../../models/TransportState';
import { getTransportState } from '../../../repositories/transport/getTransportState';
import { updateTransportState } from '../../../repositories/transport/updateTransportState';
import { setCountInBars } from '../setCountInBars';

vi.mock('../../../repositories/transport/getTransportState', () => ({
    getTransportState: vi.fn(),
}));
vi.mock('../../../repositories/transport/updateTransportState', () => ({
    updateTransportState: vi.fn(),
}));

describe('setCountInBars', () => {
    beforeEach(() => {
        vi.mocked(getTransportState).mockClear();
        vi.mocked(updateTransportState).mockClear();
    });

    it('should clamp count-in bars between 1 and 8', () => {
        const update = vi.fn();
        vi.mocked(getTransportState).mockReturnValue({ ...defaultTransportState });
        vi.mocked(updateTransportState).mockImplementation(update);

        setCountInBars(0);

        expect(update).toHaveBeenCalledWith({ countInBars: 1 });
    });

    it('should not update when transport state is missing', () => {
        const update = vi.fn();
        vi.mocked(getTransportState).mockReturnValue(null as unknown as TransportState);
        vi.mocked(updateTransportState).mockImplementation(update);

        setCountInBars(2);

        expect(update).not.toHaveBeenCalled();
    });
});
