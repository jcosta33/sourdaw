import { describe, it, expect, beforeEach } from 'vitest';
import { raveStore } from '../../../stores/rave';
import { toggleRealTime } from '../toggleRealTime';

describe('toggleRealTime', () => {
    beforeEach(() => {
        raveStore.set({
            models: [],
            activeModelId: null,
            transferBlend: 0.5,
            temperature: 1,
            realTimeEnabled: false,
            latentCache: [],
        });
    });

    it('should flip realTimeEnabled when rave state exists', () => {
        toggleRealTime();

        expect(raveStore.value?.realTimeEnabled).toBe(true);
    });

    it('should not throw when the rave store is null', () => {
        raveStore.set(null);
        expect(() => toggleRealTime()).not.toThrow();
    });
});
