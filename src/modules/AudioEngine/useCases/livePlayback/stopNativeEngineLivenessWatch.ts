/**
 * End the liveness watch `startNativeEngineLivenessWatch` (`watchNativeEngineLiveness.ts`) began.
 *
 * A no-op when no watch is running, which is every session end that already
 * abandoned the engine on its own.
 */

import { nativeLiveGraphSession } from './nativeLiveGraphSessionState';

export function stopNativeEngineLivenessWatch(): void {
    if (nativeLiveGraphSession.livenessWatch === null) {
        return;
    }
    clearInterval(nativeLiveGraphSession.livenessWatch);
    nativeLiveGraphSession.livenessWatch = null;
}
