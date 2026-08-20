import { inject } from '#/infra/di/inject';
import { logger } from '#/infra/logger/appLogger';

import { type StorageStatus, DEFAULT_CACHE_LIMIT_BYTES } from '../models/StorageStatus';

import { modelStorageWorkerBridge } from './modelStorageWorkerBridge';

type GetStorageStatusOutput = Promise<StorageStatus>;

/**
 * Compute total OPFS usage and return storage status.
 */
export const getStorageStatus = inject({ logger, modelStorageWorkerBridge })(
    ({ logger, modelStorageWorkerBridge }) =>
        async function getStorageStatus(): GetStorageStatusOutput {
            let usedBytes = 0;

            try {
                usedBytes = await modelStorageWorkerBridge.measureStorage();
            } catch (error) {
                logger.warn(`[StorageManager] Failed to measure storage: ${String(error)}`);
            }

            let availableBytes: number | null = null;
            let persisted = false;

            try {
                const estimate = await navigator.storage.estimate();
                availableBytes = (estimate.quota ?? 0) - (estimate.usage ?? 0);
            } catch {
                // storage.estimate() not available
            }

            try {
                persisted = await navigator.storage.persisted();
            } catch {
                // storage.persisted() not available
            }

            return {
                usedBytes,
                limitBytes: DEFAULT_CACHE_LIMIT_BYTES,
                persisted,
                availableBytes,
            };
        }
);
