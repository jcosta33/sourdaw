import { beforeEach, describe, expect, it, vi } from 'vitest';

import { injectDependencies } from '#/infra/di/testing/injectDependencies';

import { checkModelCached } from '../checkModelCached';

describe('checkModelCached', () => {
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn() };
    const modelStorageWorkerBridge = { checkModel: vi.fn() };

    beforeEach(() => {
        vi.clearAllMocks();
        injectDependencies(checkModelCached, { logger, modelStorageWorkerBridge });
    });

    it.each([true, false])('returns %s from the storage worker', async (cached) => {
        modelStorageWorkerBridge.checkModel.mockResolvedValue(cached);

        await expect(checkModelCached({ family: 'ddsp', modelId: 'violin' })).resolves.toBe(cached);
        expect(modelStorageWorkerBridge.checkModel).toHaveBeenCalledWith({ family: 'ddsp', modelId: 'violin' });
    });

    it('rethrows storage failures', async () => {
        const permissionError = new DOMException('denied', 'NotAllowedError');
        modelStorageWorkerBridge.checkModel.mockRejectedValue(permissionError);

        await expect(checkModelCached({ family: 'ddsp', modelId: 'violin' })).rejects.toBe(permissionError);
        expect(logger.warn).toHaveBeenCalledOnce();
    });
});
