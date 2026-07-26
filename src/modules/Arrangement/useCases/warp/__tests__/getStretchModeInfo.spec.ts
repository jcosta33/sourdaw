import { describe, expect, it } from 'vitest';

import { defaultWarpState } from '../../../models/WarpMarker';
import { STRETCH_MODES, getStretchModeInfo } from '../getStretchModeInfo';

describe('getStretchModeInfo', () => {
    it('reports repitch as the only stretch mode with a live executor', () => {
        const available = STRETCH_MODES.filter((mode) => getStretchModeInfo(mode).available);
        expect(available).toEqual(['repitch']);
    });

    it('starts new clips on a stretch mode that actually executes', () => {
        expect(getStretchModeInfo(defaultWarpState.stretchMode).available).toBe(true);
    });
});
