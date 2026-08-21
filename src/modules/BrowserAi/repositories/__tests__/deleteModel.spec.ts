import { beforeEach, describe, expect, it, vi } from 'vitest';

import { injectDependencies } from '#/infra/di/testing/injectDependencies';

import { deleteModel } from '../deleteModel';

describe('deleteModel', () => {
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn() };
    const modelStorageWorkerBridge = { deleteModel: vi.fn() };

    beforeEach(() => {
        vi.clearAllMocks();
        injectDependencies(deleteModel, { logger, modelStorageWorkerBridge });
    });

    it('delegates nested model identity to the storage worker', async () => {
        modelStorageWorkerBridge.deleteModel.mockResolvedValue(undefined);

        await deleteModel({ family: 'diffsinger/vocoder', modelId: 'test-vocoder' });

        expect(modelStorageWorkerBridge.deleteModel).toHaveBeenCalledWith({
            family: 'diffsinger/vocoder',
            modelId: 'test-vocoder',
        });
        expect(logger.info).toHaveBeenCalledOnce();
    });

    it('rethrows a storage failure so callers do not clear registry state', async () => {
        const permissionError = new DOMException('denied', 'NotAllowedError');
        modelStorageWorkerBridge.deleteModel.mockRejectedValue(permissionError);

        await expect(deleteModel({ family: 'ddsp', modelId: 'violin' })).rejects.toBe(permissionError);
        expect(logger.warn).toHaveBeenCalledOnce();
    });
});
