/**
 * Whether this process holds a live native graph session — rolling or
 * parked (#3109).
 *
 * A foreign module that wants to gate a native-facing write on session
 * existence (rather than on `isPlaying`, which says nothing about a parked
 * session) has no other way to ask: `nativeLiveGraphSessionState` stays
 * private to this module, by the same rule that keeps every other use case's
 * internals private, so this is the callable contract instead.
 */

import { nativeLiveGraphSession } from './nativeLiveGraphSessionState';

export function hasLiveNativeGraphSession(): boolean {
    return nativeLiveGraphSession.backend !== null;
}
