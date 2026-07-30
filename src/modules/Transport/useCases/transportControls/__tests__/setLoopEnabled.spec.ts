import { beforeEach, describe, expect, it, vi } from 'vitest';

import { defaultTransportState } from '../../../models/TransportState';
import { getTransportState } from '../../../repositories/transport/getTransportState';
import { updateTransportState } from '../../../repositories/transport/updateTransportState';
import { setLoopEnabled } from '../setLoopEnabled';

vi.mock('../../../repositories/transport/getTransportState', () => ({
    getTransportState: vi.fn(),
}));
vi.mock('../../../repositories/transport/updateTransportState', () => ({
    updateTransportState: vi.fn(),
}));

describe('setLoopEnabled', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('reports and writes an applicable explicit loop state', () => {
        vi.mocked(getTransportState).mockReturnValue({ ...defaultTransportState, loopStart: 4, loopEnd: 12 });

        expect(setLoopEnabled(true)).toBe(true);
        expect(updateTransportState).toHaveBeenCalledWith({ isLooping: true });
    });

    it('reports no write when enabling an invalid loop region', () => {
        vi.mocked(getTransportState).mockReturnValue({ ...defaultTransportState, loopStart: 0, loopEnd: 0 });

        expect(setLoopEnabled(true)).toBe(false);
        expect(updateTransportState).not.toHaveBeenCalled();
    });
});
