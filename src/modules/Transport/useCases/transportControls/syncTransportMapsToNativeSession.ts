/**
 * Keep a live native session's transport maps following `transportStore`, at
 * the one boundary every durable write to tempo, meter, and the loop region
 * crosses (#3109).
 *
 * Two write paths reached the native session for these fields, and two did
 * not:
 *
 *  - Every loop gesture called `sendLoopRegionToNativeSession` itself
 *    (#3105, #3107), but `setTempo` and `setTimeSignature` called nothing
 *    native at all — a tempo or meter edit made during a live session left
 *    the engine running the map it had when the session started (or last
 *    resynced), silently diverging from the Web Audio transport the musician
 *    hears.
 *  - `createAutomergeStorage`'s `fromCrdt` hydrates a remote edit, a merge,
 *    or an undo/redo straight into `transportStore` (`sanitize_transport_snapshot`
 *    in `../../stores/transportStore`), bypassing every use case above. No
 *    per-writer call, however completely it covered the gestures, could ever
 *    reach that path.
 *
 * `transportStore` is the one place both paths land, so this subscribes
 * there once instead of chasing every writer — present and future. This use
 * case, wired once at app boot, is what replaced `sendLoopRegionToNativeSession`
 * and its five call sites (`toggleLoop`, `setLoopRegion`, `setLoopEnabled`,
 * `disableLooping`, `restoreLoopRegion`); none of them call anything native
 * anymore.
 *
 * ── What counts as a change ───────────────────────────────────────────────
 *
 * Only the fields `projectEngineTransportMaps` actually reads off
 * `transportStore`: `tempo`, the time-signature default, and the loop
 * region. `isPlaying`, the playhead, and master gain change on every audio
 * block or fader move and must not spend a bridge round trip they have
 * nothing to do with — diffing the maps-relevant subset is what keeps them
 * out without special-casing any of them by name.
 *
 * ── Diffed against what was last SENT ─────────────────────────────────────
 *
 * Not the previous store snapshot. Comparing against the value last handed
 * to the session — recorded only once the round trip actually confirms it —
 * means a declined or rejected send leaves the old value on record, so the
 * very next relevant change re-attempts the whole current state rather than
 * a value already lost. That is what makes a dropped round trip safe with no
 * retry loop of its own: nothing resends on a timer, only on the next real
 * edit.
 *
 * ── Coalesced, not one send per write ─────────────────────────────────────
 *
 * The flush runs on a microtask rather than inline in the subscriber, so
 * several synchronous writes in the same tick — an undo restoring a whole
 * snapshot, a drag committing intermediate values — collapse into the one
 * send the last of them left behind, reading `transportStore.value` fresh
 * when the microtask actually runs rather than whatever value the triggering
 * write carried.
 *
 * ── Only while a session exists ───────────────────────────────────────────
 *
 * `hasLiveNativeGraphSession` gates this, not `isPlaying`. A session can be
 * parked rather than torn down — `startNativeLiveGraphSession` parks one
 * deliberately when its own maps decline, and `pausePlayback`/`stopPlayback`
 * park rather than dispose — and `updateNativeLiveGraphSessionTransportMaps`
 * is exactly as safe to send to a parked session as a rolling one. No
 * session at all is the ordinary browser-build answer and costs nothing
 * here.
 */

import { logger } from '#/infra/logger/appLogger';
import { hasLiveNativeGraphSession, updateNativeLiveGraphSessionTransportMaps } from '#/modules/AudioEngine/useCases';

import { transportStore, type TransportState } from '../../stores/transportStore';
import { projectEngineTransportMaps } from '../tempoMap/projectEngineTransportMaps';

type MapsRelevantSnapshot = Readonly<{
    tempo: number;
    timeSignatureNumerator: number;
    timeSignatureDenominator: number;
    isLooping: boolean;
    loopStart: number;
    loopEnd: number;
}>;

function readMapsRelevantSnapshot(state: TransportState): MapsRelevantSnapshot {
    return {
        tempo: state.tempo,
        timeSignatureNumerator: state.timeSignatureNumerator,
        timeSignatureDenominator: state.timeSignatureDenominator,
        isLooping: state.isLooping,
        loopStart: state.loopStart,
        loopEnd: state.loopEnd,
    };
}

function snapshotsMatch(left: MapsRelevantSnapshot, right: MapsRelevantSnapshot): boolean {
    return (
        left.tempo === right.tempo &&
        left.timeSignatureNumerator === right.timeSignatureNumerator &&
        left.timeSignatureDenominator === right.timeSignatureDenominator &&
        left.isLooping === right.isLooping &&
        left.loopStart === right.loopStart &&
        left.loopEnd === right.loopEnd
    );
}

/**
 * Subscribes to `transportStore` and returns the unsubscribe. Callers own the
 * teardown, the same contract `syncKneadToEngine` follows.
 */
export function syncTransportMapsToNativeSession(): () => void {
    // Seeded from the current store rather than left `null`: a subscriber
    // fires on the *next* write, not the one already in effect, so an
    // unseeded baseline would read the first write after subscribing as a
    // change even when it touched only `isPlaying` or master gain.
    let lastSent: MapsRelevantSnapshot | null = transportStore.value
        ? readMapsRelevantSnapshot(transportStore.value)
        : null;
    let flushScheduled = false;

    function flush(): void {
        flushScheduled = false;
        if (!hasLiveNativeGraphSession()) {
            return;
        }
        const state = transportStore.value;
        if (!state) {
            return;
        }
        const snapshot = readMapsRelevantSnapshot(state);
        if (lastSent && snapshotsMatch(lastSent, snapshot)) {
            return;
        }

        Promise.resolve(updateNativeLiveGraphSessionTransportMaps({ transportMaps: projectEngineTransportMaps() }))
            .then((result) => {
                if (result.outcome === 'declined') {
                    logger.debug(`Native live graph session did not take the transport maps: ${result.reason}`);
                    return;
                }
                // Recorded only on confirmed success — see the module doc on
                // diffing against what was last sent.
                lastSent = snapshot;
            })
            .catch((error: unknown) => {
                logger.warn(
                    new Error('Native live graph session failed to follow a transport maps edit', { cause: error })
                );
            });
    }

    function scheduleFlush(): void {
        if (flushScheduled) {
            return;
        }
        flushScheduled = true;
        void Promise.resolve().then(flush);
    }

    return transportStore.subscribe(() => {
        scheduleFlush();
    });
}
