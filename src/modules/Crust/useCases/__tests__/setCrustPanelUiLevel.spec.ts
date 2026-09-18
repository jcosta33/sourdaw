import { describe, it, expect, beforeEach } from 'vitest';

import { crustStore, crustMeterStore, getCrustState, setCrustParam } from '../../stores/crustStore';
import { setCrustPanelUiLevel } from '../setCrustPanelUiLevel';

describe('setCrustPanelUiLevel', () => {
    beforeEach(() => {
        crustStore.set({});
        crustMeterStore.set({});
        setCrustParam('d1', 'gain', 4);
        setCrustParam('d1', 'uiLevel', 1);
    });

    it('should update the addressed instance’s UI level while preserving the rest of its patch', () => {
        setCrustPanelUiLevel('d1', 4);

        const state = getCrustState('d1');
        expect(state.patch.uiLevel).toBe(4);
        expect(state.patch.gain).toBe(4);
    });

    it('keeps the level per device — another instance’s disclosure is untouched', () => {
        setCrustParam('d2', 'uiLevel', 2);

        setCrustPanelUiLevel('d1', 4);

        expect(getCrustState('d2').patch.uiLevel).toBe(2);
    });

    it('should not throw when Crust state is unavailable', () => {
        crustStore.set(null);

        expect(() => setCrustPanelUiLevel('d1', 3)).not.toThrow();
    });
});
