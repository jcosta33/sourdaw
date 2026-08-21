import { beforeEach, describe, expect, it, vi } from 'vitest';

import { injectDependencies } from '#/infra/di/testing/injectDependencies';

import { checkVerifiedModel } from '../checkVerifiedModel';

describe('checkVerifiedModel', () => {
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn() };
    const modelStorageWorkerBridge = { verifyModel: vi.fn() };

    beforeEach(() => {
        vi.clearAllMocks();
        injectDependencies(checkVerifiedModel, { logger, modelStorageWorkerBridge });
    });

    it('checks exact release identity without transferring model bytes to the renderer', async () => {
        modelStorageWorkerBridge.verifyModel.mockResolvedValue(true);

        await expect(
            checkVerifiedModel({ family: 'kokoro', modelId: 'model.onnx', sha256: 'verified', sizeBytes: 86 })
        ).resolves.toBe(true);
        expect(modelStorageWorkerBridge.verifyModel).toHaveBeenCalledWith({
            family: 'kokoro',
            modelId: 'model.onnx',
            expectedSha256: 'verified',
            expectedSizeBytes: 86,
        });
    });

    it('rethrows worker failures instead of reporting a false cache miss', async () => {
        const error = new DOMException('denied', 'NotAllowedError');
        modelStorageWorkerBridge.verifyModel.mockRejectedValue(error);

        await expect(
            checkVerifiedModel({ family: 'kokoro', modelId: 'model.onnx', sha256: 'verified', sizeBytes: 86 })
        ).rejects.toBe(error);
        expect(logger.warn).toHaveBeenCalledOnce();
    });
});
