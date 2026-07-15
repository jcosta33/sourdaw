import { inject } from '#/infra/di/inject';
import { logger } from '#/infra/logger/appLogger';

import { abortWritable } from './abortWritable';
import { createModelWritable } from './createModelWritable';

type WriteModelInput = { family: string; modelId: string; data: ArrayBuffer };
type WriteModelOutput = Promise<void>;

export const writeModel = inject({ logger })(
    ({ logger }) =>
        async function writeModel({ family, modelId, data }: WriteModelInput): WriteModelOutput {
            // `data` is a plain ArrayBuffer by contract, so it can be written in place.
            // The previous unconditional `data.slice(0)` doubled the heap for 100+ MB
            // models for no benefit -- createWritable().write() accepts an ArrayBuffer directly.
            const writable = await createModelWritable({ family, modelId });
            try {
                await writable.write(data);
                await writable.close();
            } catch (error) {
                await abortWritable(writable);
                throw error;
            }
            logger.info(`[StorageManager] Wrote model ${family}/${modelId} (${String(data.byteLength)} bytes)`);
        }
);
