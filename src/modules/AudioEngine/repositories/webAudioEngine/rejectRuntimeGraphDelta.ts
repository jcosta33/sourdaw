import type { RuntimeGraphDeltaResult } from '../../models/RuntimeGraphDelta';

/** A refusal that left the live graph untouched. */
export function rejectRuntimeGraphDelta(reason: string): RuntimeGraphDeltaResult {
    return Object.freeze({
        acceptance: 'rejected' as const,
        application: 'not-applied' as const,
        reason,
    });
}
