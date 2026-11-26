import { beforeEach, describe, expect, it, vi } from 'vitest';

import { defaultTrackState, trackStore } from '#/modules/Arrangement/stores';

import { defaultTransportState } from '../../../models/TransportState';
import { getTransportState } from '../../../repositories/transport/getTransportState';
import { updateTransportState } from '../../../repositories/transport/updateTransportState';
import { timeSignatureMapStore } from '../../../stores/timeSignatureMapStore';
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
        trackStore.set(defaultTrackState);
        timeSignatureMapStore.set({ changes: [] });
    });

    it('reports and writes an applicable explicit loop state', () => {
        vi.mocked(getTransportState).mockReturnValue({ ...defaultTransportState, loopStart: 4, loopEnd: 12 });

        expect(setLoopEnabled(true)).toBe(true);
        expect(updateTransportState).toHaveBeenCalledWith({ isLooping: true });
    });

    it('enables an empty loop region as the first bar in one write', () => {
        vi.mocked(getTransportState).mockReturnValue({ ...defaultTransportState, loopStart: 0, loopEnd: 0 });

        expect(setLoopEnabled(true)).toBe(true);
        expect(updateTransportState).toHaveBeenCalledExactlyOnceWith({ loopStart: 0, loopEnd: 4, isLooping: true });
    });

    it('reports no write when no loop region can be found for an empty region', () => {
        vi.mocked(getTransportState).mockReturnValue({
            ...defaultTransportState,
            loopStart: 0,
            loopEnd: 0,
            timeSignatureNumerator: 0,
        });

        expect(setLoopEnabled(true)).toBe(false);
        expect(updateTransportState).not.toHaveBeenCalled();
    });

    it('disables the loop without touching the region', () => {
        vi.mocked(getTransportState).mockReturnValue({ ...defaultTransportState, isLooping: true });

        expect(setLoopEnabled(false)).toBe(true);
        expect(updateTransportState).toHaveBeenCalledExactlyOnceWith({ isLooping: false });
    });
});
