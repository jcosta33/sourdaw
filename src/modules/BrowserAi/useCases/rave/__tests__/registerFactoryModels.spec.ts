import { describe, it, expect, beforeEach } from 'vitest';

import { raveStore, FACTORY_MODELS } from '../../../stores/rave';
import { registerFactoryModels } from '../registerFactoryModels';

describe('registerFactoryModels', () => {
    beforeEach(() => {
        raveStore.set({
            models: [
                {
                    id: 'stale-model',
                    name: 'Stale',
                    category: 'custom',
                    latentDim: 4,
                    sampleRate: 44100,
                    sizeMb: 1,
                    loaded: true,
                    modelPath: 'models/stale.onnx',
                },
            ],
            activeModelId: 'stale-model',
            transferBlend: 0.5,
            temperature: 1,
            realTimeEnabled: false,
            latentCache: [],
        });
    });

    it('replaces the model list with the factory catalog, all unloaded', () => {
        registerFactoryModels();

        const models = raveStore.value?.models ?? [];
        expect(models).toHaveLength(FACTORY_MODELS.length);
        expect(models.map((model) => model.id)).toEqual(FACTORY_MODELS.map((model) => model.id));
        expect(models.every((model) => model.loaded === false)).toBe(true);
    });

    it('leaves unrelated store state such as the active model id untouched', () => {
        registerFactoryModels();

        expect(raveStore.value?.activeModelId).toBe('stale-model');
    });

    it('does nothing when the rave store is null', () => {
        raveStore.set(null);

        registerFactoryModels();

        expect(raveStore.value).toBeNull();
    });
});
