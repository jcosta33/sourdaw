import { beforeEach, describe, expect, it, vi } from 'vitest';

import { defaultTransportState } from '../../../models/TransportState';
import { getTransportState } from '../../../repositories/transport/getTransportState';
import { updateTransportState } from '../../../repositories/transport/updateTransportState';
import { restoreLoopRegion } from '../restoreLoopRegion';

vi.mock('../../../repositories/transport/getTransportState', () => ({
    getTransportState: vi.fn(),
}));
vi.mock('../../../repositories/transport/updateTransportState', () => ({
    updateTransportState: vi.fn(),
}));

describe('restoreLoopRegion', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('writes the complete loop snapshot atomically', () => {
        vi.mocked(getTransportState).mockReturnValue({ ...defaultTransportState, loopStart: 0, loopEnd: 0 });

        expect(
            restoreLoopRegion({
                expected: { loopStart: 0, loopEnd: 0, isLooping: false },
                replacement: { loopStart: 4, loopEnd: 12, isLooping: true },
            })
        ).toEqual({ status: 'written' });

        expect(updateTransportState).toHaveBeenCalledWith({ loopStart: 4, loopEnd: 12, isLooping: true });
    });

    it('restores a disengaged region exactly as it was captured', () => {
        vi.mocked(getTransportState).mockReturnValue({
            ...defaultTransportState,
            loopStart: 0,
            loopEnd: 2,
            isLooping: true,
        });

        restoreLoopRegion({
            expected: { loopStart: 0, loopEnd: 2, isLooping: true },
            replacement: { loopStart: 0, loopEnd: 2, isLooping: false },
        });

        expect(updateTransportState).toHaveBeenCalledWith({ loopStart: 0, loopEnd: 2, isLooping: false });
    });

    it('does not write when transport state is missing', () => {
        vi.mocked(getTransportState).mockReturnValue(null);

        restoreLoopRegion({
            expected: { loopStart: 0, loopEnd: 0, isLooping: false },
            replacement: { loopStart: 4, loopEnd: 12, isLooping: true },
        });

        expect(updateTransportState).not.toHaveBeenCalled();
    });
});
