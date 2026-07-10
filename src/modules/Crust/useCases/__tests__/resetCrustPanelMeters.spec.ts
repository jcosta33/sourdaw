import { describe, it, expect, beforeEach } from 'vitest';

import { crustStore, defaultCrustState } from '../../stores/crustStore';
import { resetCrustPanelMeters } from '../resetCrustPanelMeters';

describe('resetCrustPanelMeters', () => {
    beforeEach(() => {
        crustStore.set({
            ...defaultCrustState,
            patch: { ...defaultCrustState.patch, name: 'Edited patch', gain: 7, uiLevel: 3 },
            grDb: -8,
            inputDb: -12,
            outputDb: -2,
            lufsIntegrated: -9,
            lufsShortTerm: -7,
            lufsMomentary: -6,
            lra: 11,
            truepeakMax: -0.2,
            truepeakExceeded: true,
        });
    });

    it('should reset every meter field while preserving the current patch', () => {
        resetCrustPanelMeters();

        expect(crustStore.value).toEqual({
            ...defaultCrustState,
            patch: { ...defaultCrustState.patch, name: 'Edited patch', gain: 7, uiLevel: 3 },
        });
    });

    it('should not throw when Crust state is unavailable', () => {
        crustStore.set(null);

        expect(() => resetCrustPanelMeters()).not.toThrow();
    });
});
