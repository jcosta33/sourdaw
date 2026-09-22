import { disarmRetrospectiveCapture as disarmRetrospectiveCaptureRepo } from '../../repositories/retrospectiveCapture/disarmRetrospectiveCapture';

/**
 * Disarm the engine's retrospective ring.
 *
 * Fire-and-forget from PunchRecording: a declined disarm is harmless when no
 * engine is running.
 */
export function disarmRetrospectiveCapture(): void {
    void disarmRetrospectiveCaptureRepo();
}
