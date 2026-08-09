import { describe, it, expect, vi, beforeEach } from 'vitest';

import { defaultTransportState } from '../../../models/TransportState';
import { getTransportState } from '../../../repositories/transport/getTransportState';
import { updateTransportState } from '../../../repositories/transport/updateTransportState';
import { togglePunchEnabled } from '../togglePunchEnabled';

vi.mock('../../../repositories/transport/getTransportState', () => ({
    getTransportState: vi.fn(),
}));
vi.mock('../../../repositories/transport/updateTransportState', () => ({
    updateTransportState: vi.fn(),
}));

describe('togglePunchEnabled', () => {
    beforeEach(() => {
        vi.mocked(getTransportState).mockClear();
        vi.mocked(updateTransportState).mockClear();
    });

    it('should flip punchInEnabled when transport state exists', () => {
        const update = vi.fn<typeof updateTransportState>();
        vi.mocked(getTransportState).mockReturnValue({ ...defaultTransportState, punchInEnabled: false });
        vi.mocked(updateTransportState).mockImplementation(update);

        togglePunchEnabled();

        expect(update).toHaveBeenCalledWith({ punchInEnabled: true });
    });

    it('should not update when transport state is missing', () => {
        const update = vi.fn<typeof updateTransportState>();
        vi.mocked(getTransportState).mockReturnValue(null);
        vi.mocked(updateTransportState).mockImplementation(update);

        togglePunchEnabled();

        expect(update).not.toHaveBeenCalled();
    });

    it.each([
        { isPlaying: true, isRecording: false },
        { isPlaying: false, isRecording: true },
    ])('does not toggle while transport is busy: %o', (busy) => {
        vi.mocked(getTransportState).mockReturnValue({
            ...defaultTransportState,
            ...busy,
            punchInEnabled: false,
        });

        const result = togglePunchEnabled();

        expect(result).toEqual({ status: 'conflict' });
        expect(updateTransportState).not.toHaveBeenCalled();
    });
});
