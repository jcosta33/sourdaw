/**
 * Tell the musician a device-chain change did not reach the rolling engine
 * (#3575).
 *
 * The carrier of a strip is fixed by the play batch, so a mid-roll change the
 * native strip cannot host is deferred rather than re-carried: it is already in
 * project truth and Web Audio already applied it, and the next play sends the
 * whole topology again. Left unsaid, that reads as a device the engineer added
 * and cannot hear, with nothing anywhere to account for it.
 *
 * Once per distinct message, exactly as the decline notice is: the same edit
 * refused twice is the same news twice.
 */

import { notifyUser } from '#/utils/Notification/notifyUser';

import { nativeLiveGraphSession } from './nativeLiveGraphSessionState';

export type DeferredChainChange = Readonly<{
    /** The strip the change was addressed to, as the musician names it. */
    trackName: string;
    /** The devices the change was about, or empty when only their order moved. */
    deviceNames: readonly string[];
    /** What the engine said when it refused the batch. */
    reason: string;
}>;

function subjectOf(deviceNames: readonly string[]): string {
    if (deviceNames.length === 0) {
        return 'The device chain';
    }
    return deviceNames.map((name) => `"${name}"`).join(', ');
}

export function notifyDeferredChainChange(change: DeferredChainChange): void {
    const subject = `${subjectOf(change.deviceNames)} on "${change.trackName}"`;
    const message = `${subject} takes effect on the next play: ${change.reason}`;
    if (nativeLiveGraphSession.lastDeferredChainNotice === message) {
        return;
    }
    nativeLiveGraphSession.lastDeferredChainNotice = message;
    notifyUser(message, 'warning');
}
