import { describe, it, expect, beforeEach } from 'vitest';

import { raveStore } from '../../../stores/rave';
import { setTemperature } from '../setTemperature';

describe('setTemperature', () => {
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

    it('should update the temperature within range', () => {
        setTemperature(1.75);

        expect(raveStore.value?.temperature).toBe(1.75);
    });

    it('should clamp temperature to the [0, 3] range', () => {
        setTemperature(5);
        expect(raveStore.value?.temperature).toBe(3);

        setTemperature(-2);
        expect(raveStore.value?.temperature).toBe(0);
    });

    it('should not write when the rave store is null', () => {
        raveStore.set(null);

        setTemperature(2);

        expect(raveStore.value).toBeNull();
    });
});
