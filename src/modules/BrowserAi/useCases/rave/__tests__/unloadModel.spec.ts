import { describe, it, expect, beforeEach } from 'vitest';

import { raveStore, type RaveModel } from '../../../stores/rave';
import { unloadModel } from '../unloadModel';

function createModel(overrides: Partial<RaveModel>): RaveModel {
    return {
        id: 'model-a',
        name: 'Model A',
        category: 'synth',
        latentDim: 8,
        sampleRate: 44100,
        sizeMb: 10,
        loaded: true,
        modelPath: 'models/a.onnx',
        ...overrides,
    };
}

describe('unloadModel', () => {
    beforeEach(() => {
        raveStore.set({
            models: [createModel({ id: 'model-a' }), createModel({ id: 'model-b' })],
            activeModelId: 'model-a',
            transferBlend: 0.5,
            temperature: 1,
            realTimeEnabled: false,
            latentCache: [],
        });
    });

    it('marks the matching model unloaded and clears the active id when it was active', () => {
        unloadModel('model-a');

        const models = raveStore.value?.models ?? [];
        expect(models.find((model) => model.id === 'model-a')?.loaded).toBe(false);
        expect(models.find((model) => model.id === 'model-b')?.loaded).toBe(true);
        expect(raveStore.value?.activeModelId).toBeNull();
    });

    it('keeps the active id untouched when unloading a model that is not active', () => {
        unloadModel('model-b');

        expect(raveStore.value?.activeModelId).toBe('model-a');
        expect(raveStore.value?.models.find((model) => model.id === 'model-b')?.loaded).toBe(false);
    });

    it('does nothing when the rave store is null', () => {
        raveStore.set(null);

        unloadModel('model-a');

        expect(raveStore.value).toBeNull();
    });
});
