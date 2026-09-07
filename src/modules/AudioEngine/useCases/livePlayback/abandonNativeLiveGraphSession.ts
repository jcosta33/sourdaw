/**
 * Give up on a native session the engine itself has stopped rendering for
 * (#3635, ADR 0044).
 *
 * ADR 0044: every path that declines releases every gate first, because
 * silence is the one outcome no fallback recovers from. A carried strip is
 * gated shut in Web Audio for exactly as long as the native engine is the one
 * sounding it — so the moment the engine stops rendering, that strip is on no
 * carrier at all until the gate reopens. Everything below runs in that order:
 * the gate first, then the writers that would otherwise keep addressing a
 * queue nothing drains, then the feed reading a playhead nobody advances,
 * then the handle itself, and only then the notice — a musician told about a
 * silence this call has not yet fixed would still be hearing it.
 *
 * The handle is retained, not dropped. The engine itself is not told this
 * session declined — nothing here can reach it, because the whole point is
 * that it is not answering — so it keeps the topology and the `playing`
 * flag this session last left it, and would render those strips again the
 * moment its stream resumes, right beside whatever Web Audio is already
 * sounding. The handle is parked on `orphanedBackend` instead of disposed,
 * and the liveness watch keeps running rather than stopping: it is that
 * orphan the watch polls for next, and `parkOrphanedNativeEngine.ts` is what
 * it calls once a reading says the engine is rendering again.
 *
 * No re-arm here, and no dedup key either: this call already nulls
 * `backend` before it can show the notice, so a second call for the same
 * backend returns at the guard below and never reaches `notifyUser` again —
 * one notice per abandoned backend, without anything held to compare
 * against. The next play starts a fresh session, which is free to show this
 * same notice again while the engine still does not render; retrying the
 * *same* handle is #3960.
 */

import { notifyUser } from '#/utils/Notification/notifyUser';

import { claimCarriedStrips } from './claimCarriedStrips';
import { clearNativeChains } from './clearNativeChains';
import { disarmNativeLiveAutomationWriter } from './disarmNativeLiveAutomationWriter';
import { disarmNativeLiveMidiWriter } from './disarmNativeLiveMidiWriter';
import { nativeLiveGraphSession } from './nativeLiveGraphSessionState';
import { stopNativeEnginePlayheadFeed } from './stopNativeEnginePlayheadFeed';

export function abandonNativeLiveGraphSession(reason: string): void {
    // First, and unconditionally — see the header, and ADR 0044's own wording:
    // the gate releases whether or not a backend exists, so a call that finds
    // no session still leaves nothing gated shut on its account.
    claimCarriedStrips(new Set());
    const backend = nativeLiveGraphSession.backend;
    if (!backend) {
        // Nothing else to abandon: no session, no writers to disarm, no handle
        // to drop, no notice to show.
        return;
    }
    disarmNativeLiveAutomationWriter();
    disarmNativeLiveMidiWriter();
    stopNativeEnginePlayheadFeed();
    nativeLiveGraphSession.orphanedBackend = backend;
    nativeLiveGraphSession.backend = null;
    nativeLiveGraphSession.rolling = false;
    nativeLiveGraphSession.audibleCarrier = false;
    clearNativeChains();
    const message =
        `Native audio engine stopped rendering: ${reason}. ` +
        'Playing through Web Audio; external plugins are silent until the engine restarts.';
    notifyUser(message, 'warning');
}
