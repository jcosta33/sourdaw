/**
 * Empty the native engine slot an abandoned session left behind, and offer the
 * transport a re-arm (#3960).
 *
 * `watchNativeEngineLiveness.ts` holds two answers about an orphan. A reading
 * that says the engine is rendering again is the park's
 * (`parkOrphanedNativeEngine.ts`): the stall passed, and the topology that
 * handle left rolling has to be stopped. A reading that still says it is not
 * rendering is this one: the engine is down for good on the device it was
 * booted against, and nothing in the slot will ever answer again. Retiring it
 * is what lets the next graph batch boot a fresh engine on the *current*
 * default device — which is the whole of the recovery a musician who unplugged
 * a headset needs.
 *
 * ── The forget comes before the offer ─────────────────────────────────────
 *
 * A retire destroys the engine-owned plugin records with the scheduler that
 * held them, and `retiredInstanceIds` is the only report of which ones. The
 * subscriber's re-arm runs `ensureTrackStrips`, whose activation short-circuits
 * on an instance PluginHost still believes is live — so the ids have to be
 * forgotten before the offer is published, or the re-armed session attaches
 * dead instances and no later batch reloads them.
 *
 * ── `no-engine` disposes, and offers nothing ──────────────────────────────
 *
 * The slot was already empty, so nothing was retired: there are no plugins to
 * reload and no engine to boot a session against on this musician's behalf.
 * The orphan handle is still spent and is dropped, and the next play boots an
 * engine the ordinary way.
 *
 * ── The retire is not itself the re-arm ───────────────────────────────────
 *
 * This module owns the engine, not the transport. Whether a musician is still
 * playing, and from what beat, is Transport's to decide — so what lands here
 * is an offer on `nativeEngineRearmStore`, and Transport's
 * `rearmNativeSessionAfterEngineRetire` decides what to do with it.
 *
 * Queued on the session's own command chain, exactly like the park, so it
 * orders after any start or stop already queued on it.
 */

import { logger } from '#/infra/logger/appLogger';
import { forgetRetiredPluginInstances } from '#/modules/PluginHost/useCases';

import { retireNativeEngine } from '../../repositories/engineLifecycle/retireNativeEngine';
import { defaultNativeEngineRearmState, nativeEngineRearmStore } from '../../stores/nativeEngineRearmStore';

import { nativeLiveGraphSession, queueOnNativeLiveGraphSession } from './nativeLiveGraphSessionState';

import type { AudioGraphBackend } from '../../models/AudioGraphBackend';

function reasonOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/**
 * Drop `orphan` and clear the field, with no identity re-check: this retire,
 * the park, and `installRolledSession` are each one whole work on
 * `queueOnNativeLiveGraphSession`'s chain, so they can never interleave and
 * find the field already moved out from under them.
 */
function releaseOrphan(orphan: AudioGraphBackend): void {
    orphan.dispose();
    nativeLiveGraphSession.orphanedBackend = null;
}

function offerNativeSessionRearm(): void {
    nativeEngineRearmStore.update((state) => ({ offers: (state ?? defaultNativeEngineRearmState).offers + 1 }));
}

export function retireOrphanedNativeEngine(): Promise<void> {
    return queueOnNativeLiveGraphSession(async (): Promise<void> => {
        const orphan = nativeLiveGraphSession.orphanedBackend;
        if (orphan === null) {
            return;
        }
        try {
            const result = await retireNativeEngine();
            if (result.outcome === 'rendering') {
                // The engine came back between the reading and this command, so
                // the slot is not this call's to empty. The orphan stays, and
                // the park arm takes it on the next `running: true` reading.
                return;
            }
            releaseOrphan(orphan);
            if (result.outcome === 'no-engine') {
                return;
            }
            forgetRetiredPluginInstances(result.retiredInstanceIds);
            offerNativeSessionRearm();
        } catch (error) {
            // The command answered, but the answer could not be read, so which
            // of the three outcomes happened is unknown — and disposing on an
            // unknown outcome would strand an engine that may still hold this
            // topology. The orphan is kept, mirroring the park's own catch; the
            // next reading retries whichever arm fits what it finds.
            logger.warn(`[AudioEngine] native engine answered the orphan retire unreadably: ${reasonOf(error)}`);
        }
    });
}
