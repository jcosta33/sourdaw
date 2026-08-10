import { inject } from '#/infra/di/inject';
import { logger } from '#/infra/logger/appLogger';

import { abortWritable } from './abortWritable';
import { createModelWritable } from './createModelWritable';

type WriteModelInput = { family: string; modelId: string; data: ArrayBuffer; signal?: AbortSignal };
type WriteModelOutput = Promise<void>;

export const writeModel = inject({ logger })(
    ({ logger }) =>
        async function writeModel({ family, modelId, data, signal }: WriteModelInput): WriteModelOutput {
            // `data` is a plain ArrayBuffer by contract, so it can be written in place.
            // The previous unconditional `data.slice(0)` doubled the heap for 100+ MB
            // models for no benefit -- createWritable().write() accepts an ArrayBuffer directly.
            const writable = await createModelWritable({ family, modelId });
            let abortPromise: Promise<void> | undefined;
            function onAbort(): void {
                abortPromise ??= abortWritable(writable);
            }
            signal?.addEventListener('abort', onAbort, { once: true });
            try {
                if (signal?.aborted) {
                    onAbort();
                    await abortPromise;
                    throw new DOMException('Aborted', 'AbortError');
                }
                await writable.write(data);
                if (signal?.aborted) {
                    onAbort();
                    await abortPromise;
                    throw new DOMException('Aborted', 'AbortError');
                }
                await writable.close();
            } catch (error) {
                await (abortPromise ?? abortWritable(writable));
                if (signal?.aborted) {
                    throw new DOMException('Aborted', 'AbortError');
                }
                throw error;
            } finally {
                signal?.removeEventListener('abort', onAbort);
            }
            if (signal?.aborted) {
                throw new DOMException('Aborted', 'AbortError');
            }
            logger.info(`[StorageManager] Wrote model ${family}/${modelId} (${String(data.byteLength)} bytes)`);
        }
);
