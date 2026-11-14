import type { RuntimeGraphDelta, RuntimeGraphDeltaResult } from '../../models/RuntimeGraphDelta';

/** An accepted delta the live graph could not be shown to match, so its owner must reconcile. */
export function needsRuntimeGraphReconciliation(
    delta: RuntimeGraphDelta,
    reason: string,
    runtimeRevision: number,
    compensation: 'not-attempted' | 'failed' = 'not-attempted'
): RuntimeGraphDeltaResult {
    return Object.freeze({
        acceptance: 'accepted' as const,
        application: 'needs-reconcile' as const,
        compensation,
        correlation: delta.correlation,
        reason,
        runtimeRevision,
    });
}
