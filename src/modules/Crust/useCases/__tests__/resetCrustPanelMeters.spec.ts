import { describe, it, expect, beforeEach } from 'vitest';

import {
    crustMeterStore,
    crustStore,
    getCrustMeters,
    getCrustState,
    INITIAL_METERS,
    setCrustParam,
    updateCrustMeters,
} from '../../stores/crustStore';
import { resetCrustPanelMeters } from '../resetCrustPanelMeters';

describe('resetCrustPanelMeters', () => {
    beforeEach(() => {
        crustStore.set({});
        crustMeterStore.set({});
        setCrustParam('d1', 'name', 'Edited patch');
        setCrustParam('d1', 'gain', 7);
        setCrustParam('d1', 'uiLevel', 3);
        updateCrustMeters('d1', {
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

    it('should reset every meter field for the addressed device while preserving its patch', () => {
        resetCrustPanelMeters('d1');

        expect(getCrustMeters('d1')).toEqual(INITIAL_METERS);
        expect(getCrustState('d1').patch.name).toBe('Edited patch');
        expect(getCrustState('d1').patch.gain).toBe(7);
        expect(getCrustState('d1').patch.uiLevel).toBe(3);
    });

    it('should not throw when Crust state is unavailable', () => {
        crustMeterStore.set(null);

        expect(() => resetCrustPanelMeters('d1')).not.toThrow();
    });
});
