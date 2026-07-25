import { describe, it, expect, vi } from 'vitest';

import { createPunchRegionRestoreAction } from '../createPunchRegionRestoreAction';

vi.mock('../../../useCases/transportQueries/getTransportState', () => ({
    getTransportState: vi.fn(),
}));

import { getTransportState } from '../../../useCases/transportQueries/getTransportState';

describe('createPunchRegionRestoreAction', () => {
    it('returns a restorePunchRegion action capturing the current punch region', () => {
        vi.mocked(getTransportState).mockReturnValue({
            punchInBeat: 4,
            punchOutBeat: 12,
        });

        const action = createPunchRegionRestoreAction();

        expect(action).toEqual({
            type: 'restorePunchRegion',
            payload: { punchInBeat: 4, punchOutBeat: 12 },
        });
    });

    it('returns null when no transport state is available', () => {
        // Defensive guard: an absent snapshot yields no restorable region.
        vi.mocked(getTransportState).mockReturnValue(undefined);

        expect(createPunchRegionRestoreAction()).toBeNull();
    });
});
