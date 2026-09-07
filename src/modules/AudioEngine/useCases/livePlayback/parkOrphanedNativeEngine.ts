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

/**
 * Dispose `orphan` and clear the field, with no identity re-check: this park
 * and `installRolledSession` (the only writer that clears `orphanedBackend`)
 * are each one whole work on `queueOnNativeLiveGraphSession`'s chain, so they
 * can never interleave and find the field already moved out from under them.
 */
function retireOrphan(orphan: AudioGraphBackend): void {
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
                retireOrphan(orphan);
            }
            // Any other application — the engine stalled again between the
            // reading and this batch — leaves the orphan in place. The next
            // `running: true` reading retries.
        } catch (error) {
            // `apply` already turns transport failures into `rejected`, so a
            // throw here means the engine answered but the answer could not
            // be read — either an unknown outcome or an applied answer with
            // unreadable reports or revision. Either way the engine may still
            // be rolling, so the handle is kept and re-parked on the next
            // `running: true` reading; the re-park is idempotent and
            // continues until a start replaces the topology and disposes the
            // orphan.
            logger.warn(`[AudioEngine] native transport answered the orphan park unreadably: ${reasonOf(error)}`);
        }
    });
}
