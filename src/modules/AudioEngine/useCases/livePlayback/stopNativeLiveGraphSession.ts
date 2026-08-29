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

import { nativeLiveGraphSession, queueOnNativeLiveGraphSession } from './nativeLiveGraphSessionState';

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
        return { outcome: 'stopped' };
    });
}
