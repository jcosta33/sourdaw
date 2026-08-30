/**
 * Keep the native sample pool ahead of the play gesture (#3068).
 *
 * `primeNativeTimelineSamples` states why the material must not travel at the
 * gesture; this is what makes sure it already has. `trackStore` is where every
 * path that can change which material a session plays lands — an import, a
 * clip edit, a freeze, a take comp, and the CRDT hydration that a remote edit
 * or an undo arrives through — so subscribing to it once covers all of them
 * rather than chasing each writer.
 *
 * ── Cheap on the paths that dominate ──────────────────────────────────────
 *
 * Every fader move and every playhead tick is a `trackStore` write, and almost
 * none of them add material. Two things keep that from costing anything: the
 * flush is a microtask, so a drag or an undo restoring a whole snapshot
 * collapses into one pass; and the pass itself stops at the pool memo, which
 * already holds every id the project has seen, so the ordinary answer is a
 * projection and no bridge traffic at all.
 *
 * ── Failure is not this subscriber's to escalate ──────────────────────────
 *
 * A browser build has no bridge and declines every time, which is the platform
 * rather than a fault. A desktop build whose registration fails leaves the ids
 * unknown, so the play gesture registers them itself and pays the wait — the
 * degradation this pass exists to avoid, never a session that plays material
 * the pool does not hold.
 */

import { logger } from '#/infra/logger/appLogger';
import { trackStore } from '#/modules/Arrangement/stores';

import { getAudioContext } from '../engineAccess/getAudioContext';

import { primeNativeTimelineSamples } from './primeNativeTimelineSamples';

/**
 * Subscribes to `trackStore` and returns the unsubscribe. Callers own the
 * teardown, the same contract `syncTransportMapsToNativeSession` follows.
 */
export function syncNativeTimelineSamples(): () => void {
    let flushScheduled = false;
    // One pass at a time: a pass is a bridge round trip, and a second one
    // started underneath it would push the same material twice — the memo
    // records an id only once its own registration confirms.
    let priming = false;
    let changedDuringPass = false;

    function pass(): void {
        if (priming) {
            changedDuringPass = true;
            return;
        }
        priming = true;
        Promise.resolve(primeNativeTimelineSamples({ sampleRate: getAudioContext().sampleRate }))
            .then((result) => {
                if (result.outcome === 'declined') {
                    logger.debug(`Native timeline sample prime declined: ${result.reason}`);
                }
            })
            .catch((error: unknown) => {
                logger.warn(new Error('Native timeline sample prime failed', { cause: error }));
            })
            .finally(() => {
                priming = false;
                if (!changedDuringPass) {
                    return;
                }
                changedDuringPass = false;
                // The project moved while this pass was in the air, so what it
                // primed may no longer be what a session would play.
                pass();
            });
    }

    function flush(): void {
        flushScheduled = false;
        pass();
    }

    return trackStore.subscribe(() => {
        if (flushScheduled) {
            return;
        }
        flushScheduled = true;
        void Promise.resolve().then(flush);
    });
}
