/**
 * End the liveness watch `startNativeEngineLivenessWatch` (`watchNativeEngineLiveness.ts`) began.
 *
 * Idempotent: a no-op when no watch is running. The only production caller is
 * the watch's own `pollOnce`, retiring itself once neither a session nor an
 * orphan remains for it to act on.
 */

import { nativeLiveGraphSession } from './nativeLiveGraphSessionState';

export function stopNativeEngineLivenessWatch(): void {
    if (nativeLiveGraphSession.livenessWatch === null) {
        return;
    }
    clearInterval(nativeLiveGraphSession.livenessWatch);
    nativeLiveGraphSession.livenessWatch = null;
}
