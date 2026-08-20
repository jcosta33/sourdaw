import { describe, it, expect, beforeEach, vi } from 'vitest';

import { injectDependencies } from '#/infra/di/testing/injectDependencies';

const releaseGate = vi.hoisted(() => ({ rave: true }));

vi.mock('#/infra/release/modelReleaseAdmission', () => ({ MODEL_RELEASE_ADMISSION: releaseGate }));

import { FACTORY_MODELS, raveStore } from '../../stores/rave';
import { initRaveModels } from '../initRaveModels';

type CheckModelCached = (input: { family: string; modelId: string }) => Promise<boolean>;

function createLoggerMock(): { info: () => void; warn: () => void; debug: () => void } {
    return { info: vi.fn(), warn: vi.fn(), debug: vi.fn() };
}

function resetRaveStore(): void {
    raveStore.set({
        models: [],
        activeModelId: null,
        transferBlend: 0.5,
        temperature: 1,
        realTimeEnabled: false,
        latentCache: [],
    });
}

describe('initRaveModels', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        releaseGate.rave = true;
        resetRaveStore();
    });

    it('does not probe or register models while RAVE artifacts are withheld', async () => {
        releaseGate.rave = false;
        const checkModelCached = vi.fn<CheckModelCached>().mockResolvedValue(true);
        injectDependencies(initRaveModels, { logger: createLoggerMock(), checkModelCached });

        await initRaveModels();

        expect(checkModelCached).not.toHaveBeenCalled();
        expect(raveStore.value?.models).toEqual([]);
        expect(raveStore.value?.activeModelId).toBeNull();
    });

    it('registers nothing when no RAVE weights are present in OPFS', async () => {
        const checkModelCached = vi.fn<CheckModelCached>().mockResolvedValue(false);
        injectDependencies(initRaveModels, { logger: createLoggerMock(), checkModelCached });

        await initRaveModels();

        expect(raveStore.value?.models).toEqual([]);
        expect(checkModelCached.mock.calls.map(([input]) => input)).toEqual(
            FACTORY_MODELS.map((model) => ({ family: 'rave', modelId: model.id }))
        );
    });

    it('registers only the catalog entries whose weights the probe found', async () => {
        const checkModelCached = vi
            .fn<CheckModelCached>()
            .mockImplementation(({ modelId }) => Promise.resolve(modelId === 'rave-vocals'));
        injectDependencies(initRaveModels, { logger: createLoggerMock(), checkModelCached });

        await initRaveModels();

        expect(raveStore.value?.models.map((model) => model.id)).toEqual(['rave-vocals']);
        expect(raveStore.value?.models.every((model) => model.loaded === false)).toBe(true);
    });

    it('treats a probe that throws as an absent model and warns rather than registering it', async () => {
        const checkModelCached = vi.fn<CheckModelCached>().mockImplementation(({ modelId }) => {
            if (modelId === 'rave-strings') {
                return Promise.reject(new DOMException('denied', 'NotAllowedError'));
            }
            return Promise.resolve(false);
        });
        const logger = createLoggerMock();
        injectDependencies(initRaveModels, { logger, checkModelCached });

        await expect(initRaveModels()).resolves.toBeUndefined();

        expect(raveStore.value?.models).toEqual([]);
        expect(logger.warn).toHaveBeenCalledWith(
            '[BrowserAi] RAVE presence probe failed for rave-strings: NotAllowedError: denied'
        );
    });

    it('clears an active model id whose weights are no longer present', async () => {
        raveStore.set({
            models: [],
            activeModelId: 'rave-strings',
            transferBlend: 0.5,
            temperature: 1,
            realTimeEnabled: false,
            latentCache: [],
        });
        const checkModelCached = vi.fn<CheckModelCached>().mockResolvedValue(false);
        injectDependencies(initRaveModels, { logger: createLoggerMock(), checkModelCached });

        await initRaveModels();

        expect(raveStore.value?.activeModelId).toBeNull();
    });

    it('keeps an active model id whose weights are still present', async () => {
        raveStore.set({
            models: [],
            activeModelId: 'rave-strings',
            transferBlend: 0.5,
            temperature: 1,
            realTimeEnabled: false,
            latentCache: [],
        });
        const checkModelCached = vi
            .fn<CheckModelCached>()
            .mockImplementation(({ modelId }) => Promise.resolve(modelId === 'rave-strings'));
        injectDependencies(initRaveModels, { logger: createLoggerMock(), checkModelCached });

        await initRaveModels();

        expect(raveStore.value?.activeModelId).toBe('rave-strings');
    });

    it('does nothing when the rave store is null', async () => {
        raveStore.set(null);
        const checkModelCached = vi.fn<CheckModelCached>().mockResolvedValue(true);
        injectDependencies(initRaveModels, { logger: createLoggerMock(), checkModelCached });

        await initRaveModels();

        expect(raveStore.value).toBeNull();
        expect(checkModelCached).not.toHaveBeenCalled();
    });
});
