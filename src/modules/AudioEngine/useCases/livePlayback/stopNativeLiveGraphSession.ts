/**
 * Tell the live native engine playback stopped (#3066, D3.c.4a).
 *
 * A no-op when no session ever started, which is the ordinary case in a browser
 * build and on any desktop run whose start declined. The engine itself is left
 * running: it is process-wide and hosts the plugin runtimes, so stopping it on
 * a transport stop would retire instances the transport never owned.
 *
 * The topology is deliberately not torn down either. A stop is not a project
 * close, and a graph left standing is what the engine holds while the plugin
 * runtimes on it stay loaded. The next start replaces it whole, so nothing here
 * has to know what changed while the transport was stopped.
 */

import { disarmNativeLiveAutomationWriter } from './disarmNativeLiveAutomationWriter';
import { nativeLiveGraphSession, queueOnNativeLiveGraphSession } from './nativeLiveGraphSessionState';
import { stopNativeEnginePlayheadFeed } from './stopNativeEnginePlayheadFeed';

export type StopNativeLiveGraphSessionInput = Readonly<{
    /** Where the playhead came to rest, on the engine's clock. */
    positionSeconds: number;
}>;

export type StopNativeLiveGraphSessionResult =
    Readonly<{ outcome: 'stopped' }> | Readonly<{ outcome: 'declined'; reason: string }>;

export function stopNativeLiveGraphSession(
    input: StopNativeLiveGraphSessionInput
): Promise<StopNativeLiveGraphSessionResult> {
    return queueOnNativeLiveGraphSession(async (): Promise<StopNativeLiveGraphSessionResult> => {
        // Stopped before the command, and whatever the command answers: the
        // feed exists to draw a rolling playhead, and one that keeps polling a
        // transport nobody is watching only burns bridge round trips.
        stopNativeEnginePlayheadFeed();
        // Disarmed for the same reason and at the same moment: a pass whose
        // transport is stopping has nothing left to write. What the engine
        // already holds is the engine's own to resolve — the park applies
        // `hold_automation`, which freezes every mixer parameter where it
        // stands rather than letting a ramp keep gliding past the stop.
        disarmNativeLiveAutomationWriter();
        const backend = nativeLiveGraphSession.backend;
        if (!backend) {
            return { outcome: 'declined', reason: 'no live native graph session' };
        }
        const result = await backend.apply({
            schemaVersion: 1,
            commands: [{ kind: 'set-transport', playing: false, positionSeconds: input.positionSeconds }],
        });
        if (result.application !== 'applied') {
            // The session stays: a refused stop means the engine did not take
            // the command, not that the graph it holds went away, and dropping
            // the handle would strand a still-playing engine with no way to
            // reach it.
            return { outcome: 'declined', reason: result.reason };
        }
        // Cleared only once the park actually applied. A refused stop leaves a
        // still-rolling engine, and recording it as parked would be a claim
        // about the engine that the engine never made.
        nativeLiveGraphSession.rolling = false;
        return { outcome: 'stopped' };
    });
}
