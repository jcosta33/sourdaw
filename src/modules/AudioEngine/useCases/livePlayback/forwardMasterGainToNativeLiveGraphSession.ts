/**
 * Put the master fader's level on the native engine while a session holds it
 * (#3596).
 *
 * A native-carried strip leaves through the native device and never crosses the
 * Web Audio master fader, so without this the fader moves one carrier and not
 * the other: pulling the master down mid-take would silence the Web Audio
 * tracks while the native ones kept playing at full level.
 *
 * Fire-and-forget, and deliberately so. The Web Audio fader has already moved by
 * the time this runs, and a level the engine refuses is stated again by the next
 * session start, which reads the same value. Awaiting the answer would put a
 * bridge round trip inside a drag.
 *
 * The level is read on the queue rather than captured at the gesture, so a
 * backlog collapses: every forward waiting behind a blocked queue states the
 * level the fader is standing at now, and a drag that outran the bridge lands on
 * its destination instead of replaying the positions it passed through.
 *
 * Sent to a parked or a shadowed session too. A parked engine approaches the
 * level from where it stands and a shadowed one writes zeros at the device
 * whatever its fader says, so both are correct the moment they start sounding —
 * which a session that was skipped would not be.
 */

import { masterGainState } from '../engineAccess/masterGainState';

import { nativeLiveGraphSession, queueOnNativeLiveGraphSession } from './nativeLiveGraphSessionState';

export function forwardMasterGainToNativeLiveGraphSession(): void {
    if (!nativeLiveGraphSession.backend) {
        return;
    }
    void queueOnNativeLiveGraphSession(async (): Promise<void> => {
        // Re-read on the queue: a stop admitted between the gesture and this
        // turn has already disposed the handle the check above saw.
        const backend = nativeLiveGraphSession.backend;
        if (!backend) {
            return;
        }
        await backend.apply({
            schemaVersion: 1,
            commands: [{ kind: 'set-master-gain', gain: masterGainState.gain }],
        });
    }).catch(() => undefined);
}
