import { beforeEach, describe, expect, it, vi } from 'vitest';

import { defaultTransportState } from '../../../models/TransportState';
import { setMetronomeVolume } from '../../../useCases/transportControls/setMetronomeVolume';
import { getTransportState } from '../../../useCases/transportQueries/getTransportState';
import { handleSetMetronomeVolume } from '../handleSetMetronomeVolume';

vi.mock('../../../useCases/transportControls/setMetronomeVolume', () => ({
    setMetronomeVolume: vi.fn(),
}));

vi.mock('../../../useCases/transportQueries/getTransportState', () => ({
    getTransportState: vi.fn(),
}));

describe('handleSetMetronomeVolume', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(getTransportState).mockReturnValue({ ...defaultTransportState, metronomeVolume: 0.4 });
    });

    it('delegates the requested volume to the transport use case', () => {
        void handleSetMetronomeVolume.execute({ type: 'setMetronomeVolume', payload: { volume: 0.75 } });

        expect(setMetronomeVolume).toHaveBeenCalledWith(0.75);
    });

    it('captures the previous metronome volume as its inverse', () => {
        expect(
            handleSetMetronomeVolume.describe({ type: 'setMetronomeVolume', payload: { volume: 0.75 } })
        ).toMatchObject({
            inverseAction: { type: 'setMetronomeVolume', payload: { volume: 0.4 } },
        });
    });

    it('describes the clamped effective metronome volume', () => {
        expect(handleSetMetronomeVolume.describe({ type: 'setMetronomeVolume', payload: { volume: 2 } }).label).toBe(
            'Set metronome volume to 100%'
        );
    });

    it('compares the clamped effective volume for no-op detection', () => {
        expect(handleSetMetronomeVolume.isNoop?.({ type: 'setMetronomeVolume', payload: { volume: 0.4 } })).toBe(true);

        vi.mocked(getTransportState).mockReturnValue({ ...defaultTransportState, metronomeVolume: 1 });
        expect(handleSetMetronomeVolume.isNoop?.({ type: 'setMetronomeVolume', payload: { volume: 2 } })).toBe(true);
        expect(handleSetMetronomeVolume.isNoop?.({ type: 'setMetronomeVolume', payload: { volume: 0.5 } })).toBe(false);
    });
});
