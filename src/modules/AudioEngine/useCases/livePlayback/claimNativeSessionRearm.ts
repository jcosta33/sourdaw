/**
 * Claim this play's one automatic re-arm of the native session (#3960).
 *
 * Returns the epoch the claim was taken at to the first caller after a stop,
 * and `null` to every caller after that, so a headset that keeps re-dying on
 * the rebuilt stream cannot cycle the renderer through an unbounded chain of
 * restarts. Cleared only by `stopNativeLiveGraphSession`.
 */

import { nativeLiveGraphSession } from './nativeLiveGraphSessionState';

export function claimNativeSessionRearm(): number | null {
    if (nativeLiveGraphSession.rearmClaimed) {
        return null;
    }
    nativeLiveGraphSession.rearmClaimed = true;
    return nativeLiveGraphSession.rearmEpoch;
}
