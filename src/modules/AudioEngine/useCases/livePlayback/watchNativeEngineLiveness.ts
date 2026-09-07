/**
 * Poll the native engine for a stall, abandon the session when it finds one,
 * and park an already-abandoned engine once it renders again (#3635).
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
 * A tick has three things it might find, in this order: nothing left to
 * watch, a live session, or an abandoned session's orphan. The first retires
 * the watch itself — once both `backend` and `orphanedBackend` are null there
 * is nothing left this poll could ever act on, and `stopNativeEngineLivenessWatch`
 * is that self-retirement, idempotent, with no other production caller. The
 * second is the stall this watch was written for: a `running: false` reading
 * queues the identity-guarded abandon. The third is the mirror case #3635
 * added — a `running: true` reading on an orphan means the stream this
 * session abandoned is calling back again with the old topology still
 * rolling, and `parkOrphanedNativeEngine.ts` is what stops it before that
 * topology sounds a second time beside Web Audio.
 *
 * The stop half lives in `stopNativeEngineLivenessWatch.ts`, the same split
 * `startNativeEnginePlayheadFeed.ts` / `stopNativeEnginePlayheadFeed.ts` already
 * use: a use-case file exports at most one function value.
 */

import { refreshEngineRtDiagnostics } from '../engineAccess/refreshEngineRtDiagnostics';

import { abandonNativeLiveGraphSession } from './abandonNativeLiveGraphSession';
import { nativeLiveGraphSession, queueOnNativeLiveGraphSession } from './nativeLiveGraphSessionState';
import { parkOrphanedNativeEngine } from './parkOrphanedNativeEngine';
import { stopNativeEngineLivenessWatch } from './stopNativeEngineLivenessWatch';

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
        // The reading describes whichever session or orphan stood when it was
        // taken, not whatever the queue finds current when its turn comes. A
        // stall that took a while to read can be queued behind a stop and a
        // fresh start, and a session the engine has already admitted again is
        // proof it is rendering — abandoning it on this stale reading would
        // tear down a session the stall never touched.
        const observed = nativeLiveGraphSession.backend;
        const orphan = nativeLiveGraphSession.orphanedBackend;
        if (observed === null && orphan === null) {
            // Nothing left this poll could ever act on: no session to stall,
            // no orphan to park. The watch retires itself rather than ticking
            // forever against handles nobody holds any more.
            stopNativeEngineLivenessWatch();
            return;
        }
        const reading = await refreshEngineRtDiagnostics();
        if (reading === null) {
            return;
        }
        if (observed !== null) {
            if (reading.running) {
                return;
            }
            void queueOnNativeLiveGraphSession(async () => {
                if (nativeLiveGraphSession.backend !== observed) {
                    return;
                }
                abandonNativeLiveGraphSession(describeStall(reading.outputStreamFault));
            });
            return;
        }
        // The session already abandoned this backend; a resumed stream is the
        // one signal that it is time to park the transport that handle left
        // rolling.
        if (reading.running) {
            void parkOrphanedNativeEngine();
        }
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
