import { describe, it, expect, vi, beforeEach } from 'vitest';

import { defaultTransportState } from '../../../models/TransportState';
import { getTransportState } from '../../../repositories/transport/getTransportState';
import { updateTransportState } from '../../../repositories/transport/updateTransportState';
import { toggleLoop } from '../toggleLoop';

vi.mock('../../../repositories/transport/getTransportState', () => ({
    getTransportState: vi.fn(),
}));
vi.mock('../../../repositories/transport/updateTransportState', () => ({
    updateTransportState: vi.fn(),
}));

describe('toggleLoop', () => {
    beforeEach(() => {
        vi.mocked(getTransportState).mockClear();
        vi.mocked(updateTransportState).mockClear();
    });

    it('enables an invalid loop with a complete first-bar region', () => {
        const update = vi.fn<typeof updateTransportState>();
        vi.mocked(getTransportState).mockReturnValue({ ...defaultTransportState, isLooping: false });
        vi.mocked(updateTransportState).mockImplementation(update);

        toggleLoop();

        expect(update).toHaveBeenCalledWith({ loopStart: 0, loopEnd: 4, isLooping: true });
    });

    it('should not update when transport state is missing', () => {
        const update = vi.fn<typeof updateTransportState>();
        vi.mocked(getTransportState).mockReturnValue(null);
        vi.mocked(updateTransportState).mockImplementation(update);

        toggleLoop();

        expect(update).not.toHaveBeenCalled();
    });
});
