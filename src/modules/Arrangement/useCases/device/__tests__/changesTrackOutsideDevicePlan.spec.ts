import { describe, expect, it } from 'vitest';

import { unplannedTrackChangeByActionType } from '../../../models/UnplannedTrackChangeByActionType';
import { changesTrackOutsideDevicePlan } from '../changesTrackOutsideDevicePlan';

describe('changesTrackOutsideDevicePlan', () => {
    it('marks exactly the actions a planned device patch cannot project', () => {
        const markedEntries = Object.entries(unplannedTrackChangeByActionType).filter(([, unplanned]) => unplanned);
        const marked = markedEntries.map(([type]) => type).sort();
        expect(marked).toEqual(
            [
                'freezeTrack',
                'unfreezeTrack',
                'restoreFreezeState',
                'flattenTrack',
                'bounceInPlace',
                'loadPreset',
                'restorePresetDeviceChain',
                'removeTrack',
                'restoreTrack',
                'discardCreatedTrack',
            ].sort()
        );
    });

    it('is true for a marked action on the same track only', () => {
        expect(changesTrackOutsideDevicePlan({ type: 'removeTrack', payload: { trackId: 'a' } }, 'a')).toBe(true);
        expect(changesTrackOutsideDevicePlan({ type: 'removeTrack', payload: { trackId: 'b' } }, 'a')).toBe(false);
    });

    it('is false for an unmarked action on the same track', () => {
        expect(changesTrackOutsideDevicePlan({ type: 'selectTrack', payload: { trackId: 'a' } }, 'a')).toBe(false);
    });
});
