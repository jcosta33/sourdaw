import { beforeEach, describe, expect, it, vi } from 'vitest';

import { defaultTransportState } from '../../../models/TransportState';
import { setMetronomeEnabled } from '../../../useCases/transportControls/setMetronomeEnabled';
import { getTransportState } from '../../../useCases/transportQueries/getTransportState';
import { handleSetMetronomeEnabled } from '../handleSetMetronomeEnabled';

vi.mock('../../../useCases/transportControls/setMetronomeEnabled', () => ({
    setMetronomeEnabled: vi.fn(),
}));

vi.mock('../../../useCases/transportQueries/getTransportState', () => ({
    getTransportState: vi.fn(),
}));

describe('handleSetMetronomeEnabled', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(getTransportState).mockReturnValue({ ...defaultTransportState, metronomeEnabled: false });
    });

    it('delegates the explicit enabled state to the transport use case', () => {
        void handleSetMetronomeEnabled.execute({ type: 'setMetronomeEnabled', payload: { enabled: true } });

        expect(setMetronomeEnabled).toHaveBeenCalledWith(true);
    });

    it('captures the previous enabled state as its inverse', () => {
        expect(
            handleSetMetronomeEnabled.describe({ type: 'setMetronomeEnabled', payload: { enabled: true } })
        ).toMatchObject({
            inverseAction: { type: 'setMetronomeEnabled', payload: { enabled: false } },
        });
    });

    it('is a no-op only when the requested enabled state already matches project truth', () => {
        expect(handleSetMetronomeEnabled.isNoop?.({ type: 'setMetronomeEnabled', payload: { enabled: false } })).toBe(
            true
        );
        expect(handleSetMetronomeEnabled.isNoop?.({ type: 'setMetronomeEnabled', payload: { enabled: true } })).toBe(
            false
        );
    });
});
