/**
 * Forget every chain the session recorded, for a session that is gone or was
 * never adopted (#3575).
 *
 * A record left behind outlives the engine it described, and the next session's
 * first mirror would count its indices against a graph that no longer exists.
 */

import { nativeLiveGraphSession } from './nativeLiveGraphSessionState';

export function clearNativeChains(): void {
    nativeLiveGraphSession.nativeChainByStripId = new Map();
}
