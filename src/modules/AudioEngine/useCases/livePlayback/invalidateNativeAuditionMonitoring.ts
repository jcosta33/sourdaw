import { nativeLiveGraphSession } from './nativeLiveGraphSessionState';

/**
 * Admission cancels even an acquiring audition synchronously. Completion only
 * advances fence validity: an older queued start installing after a newer A/B
 * gesture must be adopted by that A/B, never impersonate a newer gesture.
 */
export function invalidateNativeAuditionMonitoring(cancelAudition = true): void {
    nativeLiveGraphSession.auditionEpoch += 1;
    if (!cancelAudition) {
        return;
    }
    const invalidate = nativeLiveGraphSession.auditionInvalidation;
    nativeLiveGraphSession.auditionInvalidation = null;
    invalidate?.();
}
