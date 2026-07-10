import { describe, it, expect, beforeEach } from 'vitest';

import { crustStore, defaultCrustState } from '../../stores/crustStore';
import { resetCrustTruePeakIndicator } from '../resetCrustTruePeakIndicator';

describe('resetCrustTruePeakIndicator', () => {
    beforeEach(() => {
        crustStore.set({
            ...defaultCrustState,
            patch: { ...defaultCrustState.patch, name: 'Hot patch', uiLevel: 4 },
            grDb: -5,
            inputDb: -18,
            outputDb: -1,
            lufsIntegrated: -10,
            lufsShortTerm: -8,
            lufsMomentary: -6,
            lra: 9,
            truepeakMax: -0.1,
            truepeakExceeded: true,
        });
    });

    it('should reset only the true peak indicator fields', () => {
        resetCrustTruePeakIndicator();

        expect(crustStore.value).toEqual({
            ...defaultCrustState,
            patch: { ...defaultCrustState.patch, name: 'Hot patch', uiLevel: 4 },
            grDb: -5,
            inputDb: -18,
            outputDb: -1,
            lufsIntegrated: -10,
            lufsShortTerm: -8,
            lufsMomentary: -6,
            lra: 9,
            truepeakMax: -100,
            truepeakExceeded: false,
        });
    });

    it('should not throw when Crust state is unavailable', () => {
        crustStore.set(null);

        expect(() => resetCrustTruePeakIndicator()).not.toThrow();
    });
});
