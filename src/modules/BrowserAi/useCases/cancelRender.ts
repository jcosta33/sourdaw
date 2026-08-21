/**
 * Use case: Cancel a queued or in-progress render.
 *
 * Marks the phrase as not-rendered and removes it from the queue.
 */

import { inject } from '#/infra/di/inject';
import { logger } from '#/infra/logger/appLogger';

import { inferenceWorkerBridge } from '../repositories/inferenceWorkerBridge';
import { clearActiveRender, inferenceProgressStore } from '../stores/inferenceProgressStore';
import { cancelQueuedRender, renderQueueStore } from '../stores/renderQueueStore';

type CancelRenderInput = {
    phraseId: string;
    requestId: string;
};

export const cancelRender = inject({ logger })(
    ({ logger }) =>
        function cancelRender({ phraseId, requestId }: CancelRenderInput): void {
            logger.info(`[BrowserAi] Cancelling render: phrase=${phraseId}`);

            // Resolve the pipeline for this render. Prefer the active-render store
            // (the source of truth for what is *currently* on a worker); fall back
            // to the queue entry. A stale lookup or a missing entry must NOT default
            // to terminating the ONNX worker — that would kill unrelated DiffSinger/
            // Kokoro renders. When the pipeline is unknown, cancel nothing on the
            // worker side and only unwind the queue/status bookkeeping below.
            const activeRender = inferenceProgressStore.value?.activeRenders[requestId];
            const queueEntry = renderQueueStore.value?.entries.find(
                (event) => event.phraseId === phraseId && event.requestId === requestId
            );
            const pipeline = activeRender?.pipeline ?? queueEntry?.pipeline;

            // Cancel only THIS request on its worker — sibling renders are untouched.
            if (pipeline === 'ddsp') {
                inferenceWorkerBridge.cancelTfjsRequest(requestId);
            } else if (pipeline === 'kokoro' || pipeline === 'diffsinger') {
                // kokoro and diffsinger both run on the ONNX worker
                inferenceWorkerBridge.cancelOnnxRequest(requestId);
            }
            // Unknown pipeline → no worker teardown (avoid collateral cancellation).

            cancelQueuedRender(phraseId, requestId, activeRender?.phraseId === phraseId);
            clearActiveRender(requestId);
        }
);
