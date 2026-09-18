/**
 * Whether starting a play here could hand the transport a native session.
 *
 * The callable form of the runtime half of `probeNativeGraphTransport`, for a
 * caller that has to branch before it can await. Proving the addon answers
 * costs a round trip, so this answers only the platform question — a desktop
 * build offers a session, a browser build never does — and the session start
 * itself still decides whether the offer holds.
 */

import { isNativeGraphRuntime } from '../../repositories/nativeGraph/isNativeGraphRuntime';

export function nativeLiveGraphSessionOffered(): boolean {
    return isNativeGraphRuntime();
}
