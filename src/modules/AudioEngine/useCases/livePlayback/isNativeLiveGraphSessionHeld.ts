import { nativeLiveGraphSession } from './nativeLiveGraphSessionState';

/** True when a live native graph session holds a backend, rolling or parked. */
export function isNativeLiveGraphSessionHeld(): boolean {
    return nativeLiveGraphSession.backend !== null;
}
