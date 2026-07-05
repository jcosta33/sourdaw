import { describe, it, expect, beforeEach } from 'vitest';

import { crustStore, defaultCrustState } from '../../stores/crustStore';
import { setCrustPanelUiLevel } from '../setCrustPanelUiLevel';

describe('setCrustPanelUiLevel', () => {
    beforeEach(() => {
        crustStore.set({
            ...defaultCrustState,
            patch: { ...defaultCrustState.patch, gain: 4, uiLevel: 1 },
            inputDb: -42,
        });
    });

    it('should update the panel UI level while preserving the rest of Crust state', () => {
        setCrustPanelUiLevel(4);

        expect(crustStore.value).toEqual({
            ...defaultCrustState,
            patch: { ...defaultCrustState.patch, gain: 4, uiLevel: 4 },
            inputDb: -42,
        });
    });

    it('should not throw when Crust state is unavailable', () => {
        crustStore.set(null);

        expect(() => setCrustPanelUiLevel(3)).not.toThrow();
    });
});
