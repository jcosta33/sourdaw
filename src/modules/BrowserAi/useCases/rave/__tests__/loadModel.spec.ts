import { describe, it, expect, beforeEach, vi } from 'vitest';

import { raveStore, raveLogger, type RaveModel } from '../../../stores/rave';
import { loadModel } from '../loadModel';

function createModel(overrides: Partial<RaveModel>): RaveModel {
    return {
        id: 'model-a',
        name: 'Model A',
        category: 'synth',
        latentDim: 8,
        sampleRate: 44100,
        sizeMb: 10,
        loaded: false,
        modelPath: 'models/a.onnx',
        ...overrides,
    };
}

describe('loadModel', () => {
    beforeEach(() => {
        raveStore.set({
            models: [createModel({ id: 'model-a' }), createModel({ id: 'model-b' })],
            activeModelId: null,
            transferBlend: 0.5,
            temperature: 1,
            realTimeEnabled: false,
            latentCache: [],
        });
    });

    it('marks the matching model loaded and activates it, leaving others untouched', () => {
        loadModel('model-b');

        const models = raveStore.value?.models ?? [];
        expect(models.find((model) => model.id === 'model-b')?.loaded).toBe(true);
        expect(models.find((model) => model.id === 'model-a')?.loaded).toBe(false);
        expect(raveStore.value?.activeModelId).toBe('model-b');
    });

    it('logs an info message naming the loaded model', () => {
        const infoSpy = vi.spyOn(raveLogger, 'info');

        loadModel('model-a');

        expect(infoSpy).toHaveBeenCalledWith('RAVE model loaded: model-a');
    });

    it('does nothing when the rave store is null', () => {
        raveStore.set(null);

        loadModel('model-a');

        expect(raveStore.value).toBeNull();
    });
});
