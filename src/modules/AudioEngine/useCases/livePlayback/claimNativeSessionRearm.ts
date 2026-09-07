/**
 * Claim this play's one automatic re-arm of the native session (#3960).
 *
 * Answers true to the first caller after a stop and false to every caller
 * after that, so a headset that keeps re-dying on the rebuilt stream cannot
 * cycle the renderer through an unbounded chain of restarts. Cleared only by
 * `stopNativeLiveGraphSession`.
 */

import { nativeLiveGraphSession } from './nativeLiveGraphSessionState';

export function claimNativeSessionRearm(): boolean {
    if (nativeLiveGraphSession.rearmClaimed) {
        return false;
    }
    nativeLiveGraphSession.rearmClaimed = true;
    return true;
}
