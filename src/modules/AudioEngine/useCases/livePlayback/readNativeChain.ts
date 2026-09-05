/**
 * The engine's realized chain for one strip, as the session last observed it
 * (#3575).
 *
 * `undefined` is not an empty chain: it says this session built no such strip,
 * and a command addressed to one refuses the whole batch.
 */

import { nativeLiveGraphSession } from './nativeLiveGraphSessionState';

export function readNativeChain(stripId: string): readonly string[] | undefined {
    return nativeLiveGraphSession.nativeChainByStripId.get(stripId);
}
