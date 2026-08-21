/**
 * Use case: Cancel a queued or in-progress render.
 *
 * Marks the phrase as not-rendered and removes it from the queue.
 */

import { inject } from '#/infra/di/inject';
import { logger } from '#/infra/logger/appLogger';

import { inferenceWorkerBridge } from '../repositories/inferenceWorkerBridge';
import { clearActiveRender, inferenceProgressStore } from '../stores/inferenceProgressStore';
import { cancelQueuedRender } from '../stores/renderQueueStore';

type CancelRenderInput = {
    phraseId: string;
    requestId: string;
};

export const cancelRender = inject({ logger })(
    ({ logger }) =>
        function cancelRender({ phraseId, requestId }: CancelRenderInput): void {
            logger.info(`[BrowserAi] Cancelling render: phrase=${phraseId}`);

            // Only an active render is known to have entered a worker pipeline. A
            // queue-only request may still be preparing, so cancelling it must not
            // send a request-level cancellation to a shared worker/session.
            const activeRender = inferenceProgressStore.value?.activeRenders[requestId];
            const ownsActiveRender = activeRender?.phraseId === phraseId;
            const pipeline = ownsActiveRender ? activeRender.pipeline : undefined;

            // Cancel only THIS request on its worker — sibling renders are untouched.
            if (pipeline === 'ddsp') {
                inferenceWorkerBridge.cancelTfjsRequest(requestId);
            } else if (pipeline === 'kokoro' || pipeline === 'diffsinger') {
                // kokoro and diffsinger both run on the ONNX worker
                inferenceWorkerBridge.cancelOnnxRequest(requestId);
            }
            // Unknown pipeline → no worker teardown (avoid collateral cancellation).

            cancelQueuedRender(phraseId, requestId, ownsActiveRender);
            clearActiveRender(requestId);
        }
);
