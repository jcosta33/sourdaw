import { describe, it, expect, beforeEach } from 'vitest';

import { raveStore, FACTORY_MODELS } from '../rave';

describe('raveStore', () => {
    beforeEach(() => {
        raveStore.set({
            models: [],
            activeModelId: null,
            transferBlend: 0.5,
            temperature: 1.0,
            realTimeEnabled: false,
            latentCache: [],
        });
    });

    it('should have initial state', () => {
        expect(raveStore.value?.models).toHaveLength(0);
        expect(raveStore.value?.transferBlend).toBe(0.5);
    });

    it('should expose FACTORY_MODELS', () => {
        expect(FACTORY_MODELS.length).toBeGreaterThan(0);
        expect(FACTORY_MODELS[0]?.id).toBe('rave-strings');
    });

    it('should update state', () => {
        raveStore.update((state) => ({ ...state!, transferBlend: 0.8 }));
        expect(raveStore.value?.transferBlend).toBe(0.8);
    });
});
