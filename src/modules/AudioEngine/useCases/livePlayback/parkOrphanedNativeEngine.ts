/**
 * Park the transport of an orphaned native session once its engine is seen
 * rendering again (#3635).
 *
 * `abandonNativeLiveGraphSession` retains the abandoned handle on
 * `orphanedBackend` rather than disposing it, because the engine behind it
 * keeps rolling the topology and the `playing` flag that session last set —
 * nothing told it to stop, since the whole point of an abandon is that the
 * engine was not answering. `watchNativeEngineLiveness.ts` keeps polling for
 * exactly this handle, and calls here the moment a reading says the stream
 * is calling back again: rendering resumed with the old topology still
 * rolling is the one moment this handle can still reach the engine, and the
 * one moment it must, or those strips sound a second time beside whatever
 * Web Audio is already carrying them.
 *
 * Queued on the session's own command chain so it orders after any start or
 * stop already queued on it.
 */

import { logger } from '#/infra/logger/appLogger';

import { nativeLiveGraphSession, queueOnNativeLiveGraphSession } from './nativeLiveGraphSessionState';

import type { AudioGraphBackend } from '../../models/AudioGraphBackend';

function reasonOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/** Dispose `orphan` only if it is still the one this session is tracking. */
function retireOrphanIfCurrent(orphan: AudioGraphBackend): void {
    if (nativeLiveGraphSession.orphanedBackend !== orphan) {
        // Superseded while the apply was in flight — a later stall already
        // disposed this handle and installed its own orphan; disposing again
        // or nulling a field that no longer names this handle would be wrong.
        return;
    }
    orphan.dispose();
    nativeLiveGraphSession.orphanedBackend = null;
}

export function parkOrphanedNativeEngine(): Promise<void> {
    return queueOnNativeLiveGraphSession(async (): Promise<void> => {
        const orphan = nativeLiveGraphSession.orphanedBackend;
        if (orphan === null) {
            return;
        }
        try {
            const result = await orphan.apply({
                schemaVersion: 1,
                commands: [
                    {
                        kind: 'set-transport',
                        playing: false,
                        // Irrelevant to a park nothing will resume from — the
                        // next native start sets its own.
                        positionSeconds: 0,
                    },
                ],
            });
            if (result.application === 'applied') {
                retireOrphanIfCurrent(orphan);
            }
            // Any other application — the engine stalled again between the
            // reading and this batch — leaves the orphan in place. The next
            // `running: true` reading retries.
        } catch (error) {
            // `apply` already turns a transport rejection into `rejected`
            // (`createNativeLiveGraphBackend.ts`), so a thrown error here can
            // only be `readAppliedResult` finding an unknown outcome: the
            // engine answered, unreadably, and may well still be rolling.
            // Disposing the orphan on that would abandon the very engine this
            // park exists to stop, so the handle is kept. The next
            // `running: true` reading retries.
            logger.warn(`[AudioEngine] native transport answered the orphan park unreadably: ${reasonOf(error)}`);
        }
    });
}
