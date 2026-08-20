import { describe, it, expect, beforeEach, vi } from 'vitest';

const releaseGate = vi.hoisted(() => ({ rave: true }));

vi.mock('#/infra/release/modelReleaseAdmission', () => ({ MODEL_RELEASE_ADMISSION: releaseGate }));

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
        vi.restoreAllMocks();
        releaseGate.rave = true;
        raveStore.set({
            models: [createModel({ id: 'model-a' }), createModel({ id: 'model-b' })],
            activeModelId: null,
            transferBlend: 0.5,
            temperature: 1,
            realTimeEnabled: false,
            latentCache: [],
        });
    });

    it('rejects every model while RAVE artifacts are withheld', () => {
        releaseGate.rave = false;

        expect(() => loadModel('model-a')).toThrow('RAVE model artifacts are not admitted in this release');
        expect(raveStore.value?.activeModelId).toBeNull();
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

    it('throws instead of writing when the rave store is null', () => {
        raveStore.set(null);

        expect(() => loadModel('model-a')).toThrow('RAVE store is not initialised');
        expect(raveStore.value).toBeNull();
    });

    it('throws on a model id that is not registered rather than reporting it active', () => {
        // `initRaveModels` registers only models whose weights are in OPFS, so an
        // unregistered id means there is nothing to load. The AI runtime can issue
        // `loadRaveModel` without going through the palette.
        //
        // It has to *throw*, not return quietly. Withholding the store write is
        // only half the gate: `executeAppActionBatch` reports a handler that
        // returns cleanly as `executed`, and `notifyAiChange` then toasts the
        // user's own prompt back at them as though a model had been loaded. A
        // silent refusal produces exactly the fabricated success this branch
        // exists to remove — just one layer further out.
        const warnSpy = vi.spyOn(raveLogger, 'warn');

        expect(() => loadModel('rave-strings')).toThrow(
            'RAVE model unavailable: rave-strings — no model weights are present'
        );

        expect(raveStore.value?.activeModelId).toBeNull();
        expect(raveStore.value?.models.every((model) => model.loaded === false)).toBe(true);
        expect(warnSpy).toHaveBeenCalledWith('RAVE model unavailable: rave-strings — no model weights present');
    });

    it('throws for every model id when the registered model list is empty', () => {
        raveStore.set({
            models: [],
            activeModelId: null,
            transferBlend: 0.5,
            temperature: 1,
            realTimeEnabled: false,
            latentCache: [],
        });
        const infoSpy = vi.spyOn(raveLogger, 'info');

        expect(() => loadModel('model-a')).toThrow('no model weights are present');

        expect(raveStore.value?.activeModelId).toBeNull();
        expect(infoSpy).not.toHaveBeenCalled();
    });
});
