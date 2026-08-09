import { beforeEach, describe, expect, it, vi } from 'vitest';

import { defaultTransportState } from '../../../models/TransportState';
import { getTransportState } from '../../../repositories/transport/getTransportState';
import { updateTransportState } from '../../../repositories/transport/updateTransportState';
import { setPunchEnabled } from '../setPunchEnabled';

vi.mock('../../../repositories/transport/getTransportState', () => ({
    getTransportState: vi.fn(),
}));
vi.mock('../../../repositories/transport/updateTransportState', () => ({
    updateTransportState: vi.fn(),
}));

describe('setPunchEnabled', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('writes only punch enablement while transport is stopped', () => {
        vi.mocked(getTransportState).mockReturnValue({
            ...defaultTransportState,
            punchInEnabled: false,
            punchInBeat: 4,
            punchOutBeat: 12,
        });

        expect(setPunchEnabled({ enabled: true })).toEqual({ status: 'written' });
        expect(updateTransportState).toHaveBeenCalledWith({ punchInEnabled: true });
    });

    it('returns no-write when state is absent or replacement is already achieved', () => {
        vi.mocked(getTransportState)
            .mockReturnValueOnce(null)
            .mockReturnValueOnce({
                ...defaultTransportState,
                punchInEnabled: true,
            });

        expect(setPunchEnabled({ enabled: true })).toEqual({ status: 'no-write' });
        expect(setPunchEnabled({ enabled: true, expectedEnabled: false })).toEqual({ status: 'no-write' });
        expect(updateTransportState).not.toHaveBeenCalled();
    });

    it('returns conflict without writing on expected-state mismatch', () => {
        vi.mocked(getTransportState).mockReturnValue({ ...defaultTransportState, punchInEnabled: false });

        expect(setPunchEnabled({ enabled: true, expectedEnabled: true })).toEqual({ status: 'conflict' });
        expect(updateTransportState).not.toHaveBeenCalled();
    });

    it.each([
        { isPlaying: true, isRecording: false },
        { isPlaying: false, isRecording: true },
    ])('returns conflict without writing while transport is busy: %o', (busy) => {
        vi.mocked(getTransportState).mockReturnValue({
            ...defaultTransportState,
            ...busy,
            punchInEnabled: false,
        });

        expect(setPunchEnabled({ enabled: true })).toEqual({ status: 'conflict' });
        expect(updateTransportState).not.toHaveBeenCalled();
    });
});
