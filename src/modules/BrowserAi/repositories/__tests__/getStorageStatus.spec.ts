import { beforeEach, describe, expect, it, vi } from 'vitest';

import { injectDependencies } from '#/infra/di/testing/injectDependencies';

import { getStorageStatus } from '../getStorageStatus';

describe('getStorageStatus', () => {
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn() };
    const modelStorageWorkerBridge = { measureStorage: vi.fn() };

    beforeEach(() => {
        vi.clearAllMocks();
        modelStorageWorkerBridge.measureStorage.mockResolvedValue(120);
        Object.defineProperty(navigator, 'storage', {
            configurable: true,
            value: {
                estimate: vi.fn(() => Promise.resolve({ quota: 1_000, usage: 250 })),
                persisted: vi.fn(() => Promise.resolve(true)),
            },
        });
        injectDependencies(getStorageStatus, { logger, modelStorageWorkerBridge });
    });

    it('combines worker-owned OPFS usage with renderer storage metadata', async () => {
        await expect(getStorageStatus()).resolves.toMatchObject({
            usedBytes: 120,
            availableBytes: 750,
            persisted: true,
        });
        expect(modelStorageWorkerBridge.measureStorage).toHaveBeenCalledOnce();
    });

    it('falls back to zero used bytes when measuring storage throws', async () => {
        modelStorageWorkerBridge.measureStorage.mockRejectedValue(new Error('opfs unavailable'));

        await expect(getStorageStatus()).resolves.toMatchObject({ usedBytes: 0 });
        expect(logger.warn).toHaveBeenCalledOnce();
    });
});
