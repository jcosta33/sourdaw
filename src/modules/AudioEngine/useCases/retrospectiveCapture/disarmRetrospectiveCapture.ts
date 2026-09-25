import { disarmRetrospectiveCapture as disarmRetrospectiveCaptureRepo } from '../../repositories/retrospectiveCapture/disarmRetrospectiveCapture';
import { sendRetrospectiveCaptureRequestInOrder } from '../../services/retrospectiveCaptureRequestOrder';

/**
 * Disarm the engine's retrospective ring.
 *
 * Fire-and-forget from PunchRecording: a declined disarm is harmless when no
 * engine is running. Sent only after every earlier arm or disarm has settled,
 * so it always lands after the arm it follows.
 */
export function disarmRetrospectiveCapture(): void {
    sendRetrospectiveCaptureRequestInOrder(() => disarmRetrospectiveCaptureRepo());
}
