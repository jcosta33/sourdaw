import { beforeEach, describe, expect, it, vi } from 'vitest';

import { injectDependencies } from '#/infra/di/testing/injectDependencies';

import { readModel } from '../readModel';

describe('readModel', () => {
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn() };
    const modelStorageWorkerBridge = { readModel: vi.fn() };

    beforeEach(() => {
        vi.clearAllMocks();
        injectDependencies(readModel, { logger, modelStorageWorkerBridge });
    });

    it('returns the worker-owned transfer port without opening OPFS in the renderer', async () => {
        const port = new MessageChannel().port1;
        modelStorageWorkerBridge.readModel.mockResolvedValue(port);

        await expect(
            readModel({
                family: 'kokoro',
                modelId: 'model.onnx',
                expectedSizeBytes: 8,
                expectedSha256: 'verified',
            })
        ).resolves.toBe(port);
        expect(modelStorageWorkerBridge.readModel).toHaveBeenCalledWith({
            family: 'kokoro',
            modelId: 'model.onnx',
            expectedSizeBytes: 8,
            expectedSha256: 'verified',
        });
    });

    it('returns null when the storage worker reports the model absent', async () => {
        modelStorageWorkerBridge.readModel.mockResolvedValue(null);

        await expect(readModel({ family: 'ddsp', modelId: 'missing' })).resolves.toBeNull();
    });

    it('logs and rethrows storage worker failures', async () => {
        const permissionError = new DOMException('denied', 'NotAllowedError');
        modelStorageWorkerBridge.readModel.mockRejectedValue(permissionError);

        await expect(readModel({ family: 'ddsp', modelId: 'violin' })).rejects.toBe(permissionError);
        expect(logger.warn).toHaveBeenCalledOnce();
    });
});
