/**
 * Use case: Cancel a queued or in-progress render.
 *
 * Marks the phrase as not-rendered and removes it from the queue.
 */

import { inject } from '#/infra/di/inject';
import { logger } from '#/infra/logger/appLogger';
import { cancelQueuedRender, updateRenderStatus, renderQueueStore } from '../stores/renderQueueStore';
import { clearActiveRender } from '../stores/inferenceProgressStore';
import { inferenceWorkerBridge } from '../repositories/inferenceWorkerBridge';

type CancelRenderInput = {
    phraseId: string;
    requestId: string;
};

export const cancelRender = inject({ logger })(
    ({ logger }) =>
        function cancelRender({ phraseId, requestId }: CancelRenderInput): void {
            logger.info(`[BrowserAi] Cancelling render: phrase=${phraseId}`);

            // Determine which worker is running this render and terminate it.
            // Termination rejects all in-flight promises and allows respawn on next use.
            const entry = renderQueueStore.value?.entries.find((e) => e.phraseId === phraseId);
            if (entry?.pipeline === 'ddsp') {
                inferenceWorkerBridge.terminateTfjsWorker();
            } else {
                // kokoro and diffsinger both run on the ONNX worker
                inferenceWorkerBridge.terminateOnnxWorker();
            }

            cancelQueuedRender(phraseId);
            clearActiveRender(requestId);
            updateRenderStatus(phraseId, 'not-rendered');
        }
);
