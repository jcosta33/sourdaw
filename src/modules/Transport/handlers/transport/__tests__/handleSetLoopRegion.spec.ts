import { beforeEach, describe, expect, it, vi } from 'vitest';

import { defaultTransportState } from '../../../models/TransportState';
import { setLoopRegion } from '../../../useCases/transportControls/setLoopRegion';
import { getTransportState } from '../../../useCases/transportQueries/getTransportState';
import { handleSetLoopRegion } from '../handleSetLoopRegion';

vi.mock('../../../useCases/transportControls/setLoopRegion', () => ({
    setLoopRegion: vi.fn(),
}));

vi.mock('../../../useCases/transportQueries/getTransportState', () => ({
    getTransportState: vi.fn(),
}));

describe('handleSetLoopRegion', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(getTransportState).mockReturnValue({
            ...defaultTransportState,
            loopStart: 4,
            loopEnd: 12,
            isLooping: false,
        });
    });

    it('delegates both requested bounds to the transport use case', () => {
        void handleSetLoopRegion.execute({ type: 'setLoopRegion', payload: { startBeat: 0, endBeat: 8 } });

        expect(setLoopRegion).toHaveBeenCalledWith(0, 8, false);
    });

    it('captures the complete previous loop state through the atomic restore action', () => {
        expect(
            handleSetLoopRegion.describe({ type: 'setLoopRegion', payload: { startBeat: 0, endBeat: 8 } })
        ).toMatchObject({
            inverseAction: {
                type: 'restoreLoopRegion',
                payload: { loopStart: 4, loopEnd: 12, isLooping: false },
            },
        });
    });

    it('describes the normalized effective loop bounds', () => {
        expect(
            handleSetLoopRegion.describe({ type: 'setLoopRegion', payload: { startBeat: 12, endBeat: 4 } }).label
        ).toBe('Set loop region from beat 4 to 12');
    });

    it('compares only normalized bounds for no-op detection', () => {
        vi.mocked(getTransportState).mockReturnValue({
            ...defaultTransportState,
            loopStart: 4,
            loopEnd: 12,
            isLooping: true,
        });

        expect(handleSetLoopRegion.isNoop?.({ type: 'setLoopRegion', payload: { startBeat: 12, endBeat: 4 } })).toBe(
            true
        );

        vi.mocked(getTransportState).mockReturnValue({
            ...defaultTransportState,
            loopStart: 4,
            loopEnd: 12,
            isLooping: false,
        });
        expect(handleSetLoopRegion.isNoop?.({ type: 'setLoopRegion', payload: { startBeat: 12, endBeat: 4 } })).toBe(
            true
        );
    });
});
