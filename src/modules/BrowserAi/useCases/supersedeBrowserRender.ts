import { inject } from '#/infra/di/inject';

import { inferenceWorkerBridge } from '../repositories/inferenceWorkerBridge';
import { renderRequestCancellation } from '../repositories/renderRequestCancellation';
import { inferenceProgressStore } from '../stores/inferenceProgressStore';
import { renderQueueStore } from '../stores/renderQueueStore';

type SupersedeBrowserRenderInput = {
    phraseId: string;
    nextRequestId: string;
};

/** Cancels the exact previous phrase owner at its request and worker boundaries before replacement. */
export const supersedeBrowserRender = inject({ inferenceWorkerBridge, renderRequestCancellation })(
    ({ inferenceWorkerBridge, renderRequestCancellation }) =>
        function supersedeBrowserRender({ phraseId, nextRequestId }: SupersedeBrowserRenderInput): void {
            const queueState = renderQueueStore.value;
            const queuedOwner = queueState?.entries.find((entry) => entry.phraseId === phraseId);
            const activeOwner = Object.values(inferenceProgressStore.value?.activeRenders ?? {}).find(
                (render) => render.phraseId === phraseId
            );
            const previousRequestId =
                queuedOwner?.requestId ?? activeOwner?.requestId ?? queueState?.phraseRequestIds?.[phraseId];
            if (previousRequestId === undefined || previousRequestId === nextRequestId) {
                return;
            }
            let previousPipeline: 'ddsp' | 'diffsinger' | 'kokoro' | undefined;
            if (activeOwner?.requestId === previousRequestId) {
                previousPipeline = activeOwner.pipeline;
            } else if (queuedOwner?.requestId === previousRequestId) {
                previousPipeline = queuedOwner.pipeline;
            }

            renderRequestCancellation.cancel(phraseId, previousRequestId);
            if (previousPipeline === 'ddsp') {
                inferenceWorkerBridge.cancelTfjsRequest(previousRequestId);
            } else if (previousPipeline === 'kokoro' || previousPipeline === 'diffsinger') {
                inferenceWorkerBridge.cancelOnnxRequest(previousRequestId);
            }
        }
);
