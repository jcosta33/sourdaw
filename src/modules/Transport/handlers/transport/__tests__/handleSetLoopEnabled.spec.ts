import { beforeEach, describe, expect, it, vi } from 'vitest';

import { defaultTransportState } from '../../../models/TransportState';
import { setLoopEnabled } from '../../../useCases/transportControls/setLoopEnabled';
import { getTransportState } from '../../../useCases/transportQueries/getTransportState';
import { handleSetLoopEnabled } from '../handleSetLoopEnabled';

vi.mock('../../../useCases/transportControls/setLoopEnabled', () => ({
    setLoopEnabled: vi.fn(),
}));

vi.mock('../../../useCases/transportQueries/getTransportState', () => ({
    getTransportState: vi.fn(),
}));

describe('handleSetLoopEnabled', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(getTransportState).mockReturnValue({ ...defaultTransportState, isLooping: false });
        vi.mocked(setLoopEnabled).mockReturnValue(true);
    });

    it('delegates the explicit enabled state to the transport use case', () => {
        void handleSetLoopEnabled.execute({ type: 'setLoopEnabled', payload: { enabled: true } });

        expect(setLoopEnabled).toHaveBeenCalledWith(true);
    });

    it('captures the previous enabled state as its inverse', () => {
        expect(handleSetLoopEnabled.describe({ type: 'setLoopEnabled', payload: { enabled: true } })).toMatchObject({
            inverseAction: { type: 'setLoopEnabled', payload: { enabled: false } },
        });
    });

    it('is a no-op only when the requested enabled state already matches project truth', () => {
        expect(handleSetLoopEnabled.isNoop?.({ type: 'setLoopEnabled', payload: { enabled: false } })).toBe(true);
        expect(handleSetLoopEnabled.isNoop?.({ type: 'setLoopEnabled', payload: { enabled: true } })).toBe(false);
    });

    it('reports no write when the transport use case rejects invalid loop bounds', () => {
        vi.mocked(setLoopEnabled).mockReturnValue(false);

        expect(handleSetLoopEnabled.execute({ type: 'setLoopEnabled', payload: { enabled: true } })).toEqual({
            status: 'no-write',
        });
    });
});
