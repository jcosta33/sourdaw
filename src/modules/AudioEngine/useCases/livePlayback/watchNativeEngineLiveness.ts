/**
 * Poll the native engine for a stall, and abandon the session when it finds one
 * (#3635).
 *
 * The watch reuses `refreshEngineRtDiagnostics` rather than reading the bridge
 * itself, because that use case drains the engine's event ring: a second
 * reader here would split that drain between two callers, and each would see
 * only part of it. One second is not an arbitrary cadence either — it is the
 * engine's own stall window, `RENDER_LIVENESS_POLICY` in
 * `crates/daw-engine/src/audio_thread.rs`, so a poll any slower would let a
 * musician sit through more silence than the engine itself needs to declare
 * the stream gone.
 *
 * The stop half lives in `stopNativeEngineLivenessWatch.ts`, the same split
 * `startNativeEnginePlayheadFeed.ts` / `stopNativeEnginePlayheadFeed.ts` already
 * use: a use-case file exports at most one function value.
 */

import { refreshEngineRtDiagnostics } from '../engineAccess/refreshEngineRtDiagnostics';

import { abandonNativeLiveGraphSession } from './abandonNativeLiveGraphSession';
import { nativeLiveGraphSession, queueOnNativeLiveGraphSession } from './nativeLiveGraphSessionState';

import type { EngineStreamErrorKind } from '../../models/EngineRtDiagnostics';

/** `RENDER_LIVENESS_POLICY` in `crates/daw-engine/src/audio_thread.rs`. */
export const NATIVE_ENGINE_LIVENESS_POLL_MS = 1_000;

/** One reading in flight at a time, so an overlapping tick skips rather than doubles up the bridge call. */
let inFlight = false;

function describeStall(fault: EngineStreamErrorKind | null): string {
    if (fault === null) {
        return 'the output stream stopped calling back';
    }
    return `the output stream stopped calling back after reporting ${fault}`;
}

async function pollOnce(): Promise<void> {
    if (inFlight) {
        return;
    }
    inFlight = true;
    try {
        const reading = await refreshEngineRtDiagnostics();
        if (reading === null || reading.running) {
            return;
        }
        void queueOnNativeLiveGraphSession(async () => {
            abandonNativeLiveGraphSession(describeStall(reading.outputStreamFault));
        });
    } finally {
        inFlight = false;
    }
}

/** Begin polling. Idempotent: a second start on a running watch changes nothing. */
export function startNativeEngineLivenessWatch(): void {
    if (nativeLiveGraphSession.livenessWatch !== null) {
        return;
    }
    nativeLiveGraphSession.livenessWatch = setInterval(() => {
        void pollOnce();
    }, NATIVE_ENGINE_LIVENESS_POLL_MS);
}
