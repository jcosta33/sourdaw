/**
 * Keep a live native session's transport maps following `transportStore`,
 * `tempoMapStore`, and `timeSignatureMapStore` — the three stores every
 * durable write to tempo, meter, and the loop region crosses (#3109).
 *
 * Two write paths reached the native session for these fields, and two did
 * not:
 *
 *  - Every loop gesture called `sendLoopRegionToNativeSession` itself
 *    (#3105, #3107), but `setTempo`, `setTimeSignature`, and every tempo-map
 *    or meter-map writer (`addTempoChange`, `updateTempoChange`,
 *    `removeTempoChange`, `replaceTempoMap`, `shiftTimelineMapsAfterBeat`,
 *    `deleteTimelineMapsTimeRange`, `addTimeSignatureChange`,
 *    `removeTimeSignatureChange`, `replaceTimeSignatureMap`) called nothing
 *    native at all — a tempo, ramp, or meter edit made during a live session
 *    left the engine running the map it had when the session started (or
 *    last resynced), silently diverging from the Web Audio transport the
 *    musician hears.
 *  - `createAutomergeStorage`'s `fromCrdt` hydrates a remote edit, a merge,
 *    or an undo/redo straight into any of the three stores, bypassing every
 *    use case above. No per-writer call, however completely it covered the
 *    gestures, could ever reach that path.
 *
 * These three stores are the one place every path lands, so this subscribes
 * to all three once instead of chasing every writer — present and future.
 * `projectEngineTransportMaps` is the tell: it builds the engine's tempo and
 * meter segments from `tempoMapStore.value.changes` and
 * `timeSignatureMapStore.value.changes`, not from anything on
 * `transportStore` alone, so a subscription that watched `transportStore`
 * only was watching two of the three inputs to what it was sending. This use
 * case, wired once at app boot, is what replaced
 * `sendLoopRegionToNativeSession` and its five call sites (`toggleLoop`,
 * `setLoopRegion`, `setLoopEnabled`, `disableLooping`, `restoreLoopRegion`);
 * none of them call anything native anymore.
 *
 * ── What counts as a change ───────────────────────────────────────────────
 *
 * Only the fields `projectEngineTransportMaps` actually reads: `tempo`, the
 * time-signature default, and the loop region off `transportStore`, plus the
 * `changes` array off each map store. `isPlaying`, the playhead, and master
 * gain change on every audio block or fader move and must not spend a bridge
 * round trip they have nothing to do with — diffing exactly this subset is
 * what keeps them out without special-casing any of them by name.
 *
 * The two map arrays are diffed by reference, not by content. Every writer in
 * both stores (`addTempoChange`, `replaceTempoMap`, `addTimeSignatureChange`,
 * etc.) calls `.set` with a freshly built array — spread, `map`, or `filter`
 * — never a mutated one, so a real edit always hands the store a new array
 * identity and a reference compare is exact for it. It can occasionally
 * over-fire on a `.set` that re-commits an identical map as a new array (a
 * false positive, not a false negative — an extra send, never a missed one),
 * which is the cheap side to be wrong on.
 *
 * ── Diffed against what was last SENT ─────────────────────────────────────
 *
 * Not the previous store snapshot. Comparing against the value last handed
 * to the session — recorded only once the round trip actually confirms it —
 * means a declined or rejected send leaves the old value on record, so the
 * very next relevant change re-attempts the whole current state rather than
 * a value already lost.
 *
 * ── Coalesced, not one send per write ─────────────────────────────────────
 *
 * The flush runs on a microtask rather than inline in the subscriber, so
 * several synchronous writes in the same tick — an undo restoring a whole
 * snapshot, a drag committing intermediate values — collapse into the one
 * send the last of them left behind, reading every store fresh when the
 * microtask actually runs rather than whatever value the triggering write
 * carried.
 *
 * ── One round trip at a time, re-checked on settle ────────────────────────
 *
 * A send is a bridge round trip, not a microtask, so it can still be in
 * flight when a later write lands — and a plain "diff against `lastSent`"
 * is unsound across that window: `lastSent` does not move until *this*
 * flight resolves, so a store value that happens to revert to the old
 * `lastSent` mid-flight reads as "already synced" and is dropped, while the
 * flight that is still in the air is about to advance `lastSent` to a value
 * the store no longer holds. Concretely: `lastSent` is 120, a write to 140
 * starts a send, a write back to 120 arrives before that send resolves — a
 * diff at that moment reads 120 against the still-stale `lastSent` of 120
 * and finds nothing to do, and when the flight then resolves `lastSent`
 * jumps to 140. The store says 120, the engine holds 140, and the diff law
 * believes it is synced.
 *
 * `sending` closes that window: a write that lands mid-flight schedules a
 * flush as usual, but `attemptSend` sees `sending`, does nothing else on
 * that call — no second flight starts, no decision is made from a
 * `lastSent` that is about to change — and only records that a write was
 * seen while a flight was in the air (`changedDuringFlight`). The flight's
 * own `finally` is what re-checks: if and only if `changedDuringFlight` was
 * set, it re-reads every store live and re-diffs against whatever
 * `lastSent` just settled to (advanced on `updated`, left alone on
 * `declined` or a rejection), sending again if they still differ. In the
 * scenario above that recheck reads the store's current 120 against the
 * just-advanced `lastSent` of 140, finds a real difference, and sends 120 —
 * which is also what closes a decline or a rejection that a change happened
 * to land underneath: the recheck fires from the live store, never from the
 * value that was declined or rejected.
 *
 * A settle with no write seen during the flight does not retry on its own —
 * a plain decline or rejection leaves the old `lastSent` in place and waits
 * for the next real edit to try again, exactly as it did before this store
 * could race a flight; `changedDuringFlight` is what tells the two cases
 * apart. Nothing here is a timer: the only two triggers are the microtask
 * flush from a store write and this one gated recheck at flight settle, so a
 * store that stops changing produces no further sends.
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

import { type TempoChange, tempoMapStore } from '../../stores/tempoMapStore';
import { type TimeSignatureChange, timeSignatureMapStore } from '../../stores/timeSignatureMapStore';
import { transportStore } from '../../stores/transportStore';
import { projectEngineTransportMaps } from '../tempoMap/projectEngineTransportMaps';

type MapsRelevantSnapshot = Readonly<{
    tempo: number;
    timeSignatureNumerator: number;
    timeSignatureDenominator: number;
    isLooping: boolean;
    loopStart: number;
    loopEnd: number;
    tempoChanges: readonly TempoChange[];
    timeSignatureChanges: readonly TimeSignatureChange[];
}>;

/** `null` when any of the three stores has not been seeded yet. */
function readCurrentSnapshot(): MapsRelevantSnapshot | null {
    const transport = transportStore.value;
    const tempoMap = tempoMapStore.value;
    const timeSignatureMap = timeSignatureMapStore.value;
    if (!transport || !tempoMap || !timeSignatureMap) {
        return null;
    }
    return {
        tempo: transport.tempo,
        timeSignatureNumerator: transport.timeSignatureNumerator,
        timeSignatureDenominator: transport.timeSignatureDenominator,
        isLooping: transport.isLooping,
        loopStart: transport.loopStart,
        loopEnd: transport.loopEnd,
        tempoChanges: tempoMap.changes,
        timeSignatureChanges: timeSignatureMap.changes,
    };
}

function snapshotsMatch(left: MapsRelevantSnapshot, right: MapsRelevantSnapshot): boolean {
    return (
        left.tempo === right.tempo &&
        left.timeSignatureNumerator === right.timeSignatureNumerator &&
        left.timeSignatureDenominator === right.timeSignatureDenominator &&
        left.isLooping === right.isLooping &&
        left.loopStart === right.loopStart &&
        left.loopEnd === right.loopEnd &&
        // Reference compares — see the module doc on why a writer's own
        // array identity is a sound and cheap stand-in for its content.
        left.tempoChanges === right.tempoChanges &&
        left.timeSignatureChanges === right.timeSignatureChanges
    );
}

/**
 * Subscribes to `transportStore`, `tempoMapStore`, and `timeSignatureMapStore`
 * and returns the unsubscribe. Callers own the teardown, the same contract
 * `syncKneadToEngine` follows.
 */
export function syncTransportMapsToNativeSession(): () => void {
    // Seeded from the current stores rather than left `null`: a subscriber
    // fires on the *next* write, not the one already in effect, so an
    // unseeded baseline would read the first write after subscribing as a
    // change even when it touched only `isPlaying` or master gain.
    let lastSent: MapsRelevantSnapshot | null = readCurrentSnapshot();
    let flushScheduled = false;
    // True for the span of one round trip. See the module doc's "one round
    // trip at a time" section for why a plain lastSent diff is unsound while
    // this is true.
    let sending = false;
    // Set when a write is seen while `sending` is true, so the flight's
    // settle knows whether to re-check at all — see the module doc.
    let changedDuringFlight = false;

    function attemptSend(): void {
        if (sending) {
            changedDuringFlight = true;
            return;
        }
        if (!hasLiveNativeGraphSession()) {
            return;
        }
        const snapshot = readCurrentSnapshot();
        if (!snapshot) {
            return;
        }
        if (lastSent && snapshotsMatch(lastSent, snapshot)) {
            return;
        }

        sending = true;
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
            })
            .finally(() => {
                sending = false;
                if (!changedDuringFlight) {
                    return;
                }
                changedDuringFlight = false;
                // A write raced this flight; re-read every store live and
                // re-diff against whatever `lastSent` just settled to. See
                // the module doc's "one round trip at a time" section.
                attemptSend();
            });
    }

    function flush(): void {
        flushScheduled = false;
        attemptSend();
    }

    function scheduleFlush(): void {
        if (flushScheduled) {
            return;
        }
        flushScheduled = true;
        void Promise.resolve().then(flush);
    }

    const unsubscribeTransport = transportStore.subscribe(() => {
        scheduleFlush();
    });
    const unsubscribeTempoMap = tempoMapStore.subscribe(() => {
        scheduleFlush();
    });
    const unsubscribeTimeSignatureMap = timeSignatureMapStore.subscribe(() => {
        scheduleFlush();
    });

    return () => {
        unsubscribeTransport();
        unsubscribeTempoMap();
        unsubscribeTimeSignatureMap();
    };
}
