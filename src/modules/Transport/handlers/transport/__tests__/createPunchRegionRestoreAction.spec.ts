import { describe, it, expect } from 'vitest';

import { createPunchRegionRestoreAction } from '../createPunchRegionRestoreAction';

describe('createPunchRegionRestoreAction', () => {
    it('returns a guarded restorePunchRegion action with exact expected and replacement pairs', () => {
        const payload = {
            expected: { punchInBeat: 20, punchOutBeat: 21 },
            replacement: { punchInBeat: 4, punchOutBeat: 12 },
        };
        const action = createPunchRegionRestoreAction(payload);

        expect(action).toEqual({
            type: 'restorePunchRegion',
            payload,
        });
    });
});
