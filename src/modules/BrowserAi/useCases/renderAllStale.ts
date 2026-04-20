/**
 * Use case: Queue all stale phrases for re-render.
 *
 * Finds all phrases with 'stale' status in the render queue
 * and re-queues them in background order.
 */

import { inject } from '#/infra/di/inject';
import { logger } from '#/infra/logger/appLogger';

import { renderQueueStore, enqueueRender } from '../stores/renderQueueStore';

export const renderAllStale = inject({ logger })(
    ({ logger }) =>
        function renderAllStale(): void {
            const state = renderQueueStore.value;
            if (!state) {
                return;
            }

            const stalePhraseIds = Object.entries(state.phraseStatusMap)
                .filter(([, status]) => status === 'stale')
                .map(([phraseId]) => phraseId);

            logger.info(`[BrowserAi] Queuing ${String(stalePhraseIds.length)} stale phrases for re-render`);

            for (const phraseId of stalePhraseIds) {
                // Look up the pipeline from the existing entry (preserved by markRenderComplete).
                const existingEntry = state.entries.find((e) => e.phraseId === phraseId);
                if (!existingEntry) {
                    logger.warn(`[BrowserAi] Cannot re-queue ${phraseId} — no entry found, pipeline unknown`);
                    continue;
                }
                const requestId = crypto.randomUUID();
                enqueueRender({
                    phraseId,
                    requestId,
                    pipeline: existingEntry.pipeline,
                    status: 'queued',
                    queuedAt: Date.now(),
                });
            }
        }
);
