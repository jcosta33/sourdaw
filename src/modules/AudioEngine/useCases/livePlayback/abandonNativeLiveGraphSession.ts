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
 * queue nothing drains, then the feed reading a playhead nobody advances, then
 * the watch that found the stall, then the handle itself, and only then the
 * notice — a musician told about a silence this call has not yet fixed would
 * still be hearing it.
 *
 * No re-arm here. The next play starts a fresh session, which is free to
 * decline again with this same notice while the engine still does not render;
 * retrying the *same* handle is #3960.
 */

import { notifyUser } from '#/utils/Notification/notifyUser';

import { claimCarriedStrips } from './claimCarriedStrips';
import { clearNativeChains } from './clearNativeChains';
import { disarmNativeLiveAutomationWriter } from './disarmNativeLiveAutomationWriter';
import { disarmNativeLiveMidiWriter } from './disarmNativeLiveMidiWriter';
import { nativeLiveGraphSession } from './nativeLiveGraphSessionState';
import { stopNativeEngineLivenessWatch } from './stopNativeEngineLivenessWatch';
import { stopNativeEnginePlayheadFeed } from './stopNativeEnginePlayheadFeed';

export function abandonNativeLiveGraphSession(reason: string): void {
    const backend = nativeLiveGraphSession.backend;
    if (!backend) {
        // Nothing to abandon: no session, no gate to release, no notice to show.
        return;
    }
    // First, and unconditionally — see the header. Web Audio sounds every
    // carried strip again before anything else here happens.
    claimCarriedStrips(new Set());
    disarmNativeLiveAutomationWriter();
    disarmNativeLiveMidiWriter();
    stopNativeEnginePlayheadFeed();
    stopNativeEngineLivenessWatch();
    backend.dispose();
    nativeLiveGraphSession.backend = null;
    nativeLiveGraphSession.rolling = false;
    nativeLiveGraphSession.audibleCarrier = false;
    clearNativeChains();
    const message =
        `Native audio engine stopped rendering: ${reason}. ` +
        'Playing through Web Audio; external plugins are silent until the engine restarts.';
    if (nativeLiveGraphSession.lastStreamLossNotice === message) {
        return;
    }
    nativeLiveGraphSession.lastStreamLossNotice = message;
    notifyUser(message, 'warning');
}
