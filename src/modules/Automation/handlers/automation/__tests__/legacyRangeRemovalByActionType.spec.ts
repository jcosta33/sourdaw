import { describe, expect, it } from 'vitest';

import { legacyRangeRemovalByActionType } from '../isLegacyRangeWriteSessionEntry';

describe('legacyRangeRemovalByActionType', () => {
    it('names a guarded removal for exactly the three retired section range writes', () => {
        const retired = Object.entries(legacyRangeRemovalByActionType)
            .filter(([, removalOf]) => removalOf !== legacyRangeRemovalByActionType.addTrack)
            .map(([type]) => type);

        expect(retired.toSorted()).toEqual(['automateSendRange', 'automateSendRanges', 'automateTrackGainRange']);
    });
});
