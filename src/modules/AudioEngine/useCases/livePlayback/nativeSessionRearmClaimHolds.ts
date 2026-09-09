/**
 * Whether a claim taken at `claim` still belongs to the play running now
 * (#3960).
 *
 * A stop bumps the epoch, and so does a start, so a claim taken before either
 * can never hold after it: the play it was taken for is over or has been
 * superseded, and whatever play is running now owns its own claim. Held apart
 * from `claimNativeSessionRearm` because a use-case file exports exactly one
 * function (`sourdaw/no-multiple-function-exports`).
 */

import { nativeLiveGraphSession } from './nativeLiveGraphSessionState';

export function nativeSessionRearmClaimHolds(claim: number): boolean {
    return nativeLiveGraphSession.rearmClaimed && nativeLiveGraphSession.rearmEpoch === claim;
}
