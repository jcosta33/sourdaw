import { logger } from '#/infra/logger/appLogger';

import { measuredPreviewAuditionRuntime } from '../services/measuredPreviewAuditionRuntime';
import { measuredPreviewAuditionStore } from '../stores/measuredPreviewAuditionStore';

/** Stop only the named application-owned audition, synchronously before awaiting restoration. */
export function stopMeasuredPreviewAudition(
    input: { confirmationId?: string; operationId?: string } = {}
): Promise<{ status: 'idle' | 'stopped' } | { status: 'restore-failed'; reason: string }> {
    const runtime = measuredPreviewAuditionRuntime;
    const operation = input.operationId === undefined ? runtime.current : runtime.operations.get(input.operationId);
    if (
        operation == null ||
        (input.confirmationId !== undefined && operation.confirmationId !== input.confirmationId)
    ) {
        return Promise.resolve({ status: 'idle' });
    }
    if (operation.restoration === null) {
        // Abort, source stop and ended handlers may reenter this use case.
        // Publish their shared settlement before invoking any of those callbacks.
        const settled = Promise.withResolvers<void>();
        operation.restoration = settled.promise;
        try {
            operation.abort.abort();
            operation.releaseObservers();
            Promise.resolve(operation.stopPlayback?.()).then(settled.resolve, settled.reject);
        } catch (error) {
            settled.reject(error);
        }
    }
    if (runtime.current === operation) {
        measuredPreviewAuditionStore.set({
            confirmationId: operation.confirmationId,
            operationId: operation.id,
            targetId: operation.targetId,
            side: operation.side,
            phase: 'releasing',
            error: null,
        });
    }
    return operation.restoration.then(
        () => {
            runtime.operations.delete(operation.id);
            if (runtime.current === operation) {
                runtime.current = null;
                measuredPreviewAuditionStore.set({
                    confirmationId: operation.confirmationId,
                    operationId: null,
                    targetId: null,
                    side: null,
                    phase: 'idle',
                    error: null,
                });
            }
            return { status: 'stopped' as const };
        },
        (error: unknown) => {
            const reason = error instanceof Error ? error.message : 'The listening output could not be restored.';
            if (runtime.current === operation) {
                measuredPreviewAuditionStore.set({
                    confirmationId: operation.confirmationId,
                    operationId: operation.id,
                    targetId: operation.targetId,
                    side: operation.side,
                    phase: 'restore-failed',
                    error: reason,
                });
            } else {
                runtime.operations.delete(operation.id);
            }
            logger.warn(new Error('Measured audition output restoration failed', { cause: error }));
            return { status: 'restore-failed' as const, reason };
        }
    );
}
