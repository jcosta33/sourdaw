/**
 * The one live native graph session this process may hold.
 *
 * Module state rather than a parameter for the same reason the playhead
 * scheduler's session is: the engine it names is process-wide — one audio
 * stream, one graph registry — so a second session object would be a second
 * belief about a thing there is only one of.
 *
 * `pending` serialises the session's own commands. Start and stop are fired
 * from transport gestures that a musician can produce faster than a bridge
 * round trip completes, and the native registry applies batches in arrival
 * order: without a chain, a stop that overtook its start would leave the engine
 * playing a topology the app thinks it stopped.
 */

import { type AudioGraphBackend } from '../../models/AudioGraphBackend';
import { type EngineLoopRegion } from '../../models/EngineTransportPosition';

export type NativeLiveGraphSession = {
    backend: AudioGraphBackend | null;
    /**
     * The handle of a session the renderer abandoned on a stall, retained
     * until the engine is seen rendering again so the transport it left
     * rolling can be parked.
     *
     * A stall abandon (`abandonNativeLiveGraphSession.ts`) is renderer-side
     * only: the engine keeps the abandoned topology and its `playing` flag,
     * because nothing tells it otherwise. A stream that resumes callbacks
     * would then render those strips again from the frozen position, right
     * beside whatever Web Audio is already sounding — doubled, out-of-phase
     * audio with no route back, because the watch this session started keeps
     * running for exactly this reason (`watchNativeEngineLiveness.ts`), and
     * `parkOrphanedNativeEngine.ts` is what it calls once a reading says the
     * engine is rendering again.
     *
     * At most one of {@link backend} and this field is ever set: an abandon
     * moves the handle from `backend` to here, and installing a rolled
     * session (`installRolledSession` in `startNativeLiveGraphSession.ts`)
     * nulls this field before it adopts a new one into `backend`.
     */
    orphanedBackend: AudioGraphBackend | null;
    /**
     * Whether this session's engine is the one a musician is actually hearing.
     *
     * Two independent conditions, and both have to hold: the batch has to
     * carry at least one strip the engine was told to contribute (a strip Web
     * Audio has been gated out of is one only this engine can voice, whether a
     * clip plays on it or a hosted plugin generates into it, and a batch that
     * carries none leaves every strip where it was), and the monitor has to be
     * open (a shadowed engine writes true zeros at the device however full its
     * timeline is). Naming it for the conclusion rather than for either half is
     * deliberate — the earlier `carriesAudio` asked only whether clips were
     * scheduled, and the day a shadowed session schedules a real programme that
     * reading is wrong in the direction that moves the playback cursor onto an
     * engine nobody can hear.
     *
     * Anything that must follow the audible transport — the playback cursor
     * above all — reads this rather than assuming a running engine is the one
     * making the sound.
     */
    audibleCarrier: boolean;
    /**
     * Whether this session left the engine's monitor shadowed.
     *
     * Held because it is a live mode rather than a property of the batch: the
     * cutover lifts it on a session that is already rolling, and
     * {@link audibleCarrier} has to be recomputed when it does.
     */
    monitorShadowed: boolean;
    /**
     * Whether this session left the engine's transport rendering.
     *
     * The engine's own `is_playing`, as far as the app knows it — which is not
     * the same as the app's transport state. A session can be started and
     * deliberately parked: `startNativeLiveGraphSession` refuses to roll when
     * the transport maps decline, because a roll would run the take under the
     * previous take's tempo map and loop seam. Anything that would move a
     * rolling engine reads this, so it cannot set a parked one rolling as a
     * side effect of doing so.
     */
    rolling: boolean;
    /**
     * The loop region this session installed on the engine, as it asked for it,
     * or `null` when it installed none.
     *
     * Held because the graph batch cannot address it: the region travels with
     * the transport maps (`engine_transport_set_maps`), so the only record of
     * what the engine is wrapping is the one this session keeps.
     */
    loopRegion: EngineLoopRegion | null;
    /**
     * Whether the engine reported it will actually wrap that region.
     *
     * Not an echo of the request: a region shorter than the engine's floor is
     * held and not honoured (`EngineTransportMapsApplied.loopEnabled`), and an
     * automation writer that treated it as a loop would keep waiting to re-arm
     * at a seam the engine never closes.
     */
    loopEnabled: boolean;
    /**
     * The decline notice this session last put in front of the musician, or
     * `null` when it has shown none.
     *
     * A desktop engine that cannot start fails the same way on every play, and
     * a musician who pressed play four times does not need to be told four
     * times. Held rather than derived because the text is the whole identity of
     * the notice: a *different* reason is news and is shown again.
     */
    lastDeclineNotice: string | null;
    /**
     * The silent-plugin notice this session last showed, under the same rule and
     * for the same reason: the list changes only when the project or the
     * engine's attach state does.
     */
    lastSilentPluginNotice: string | null;
    /**
     * The deferred-chain-change notice this session last showed, under the same
     * rule as the two above.
     */
    lastDeferredChainNotice: string | null;
    /**
     * The running liveness poll this session started, or `null` when none is
     * running.
     *
     * Held so `startNativeEngineLivenessWatch` can stay idempotent, and so the
     * watch's own `pollOnce` can find and clear the interval when it retires
     * itself — the only production caller of `stopNativeEngineLivenessWatch`.
     */
    livenessWatch: ReturnType<typeof setInterval> | null;
    /**
     * What the engine's chain holds, per strip this session built, in graph
     * order.
     *
     * The engine's own observation rather than the project's chain: a device
     * the mapper degraded is absent here, and every index a chain edit
     * addresses is an index into *this* list. Written from the `reports` of
     * every applied batch the session sends, because that is the only readback
     * of the realized chain there is.
     *
     * A strip missing from this map is a strip this session never built — a
     * track added mid-roll — and a chain edit on one has nothing to mirror
     * into.
     */
    nativeChainByStripId: ReadonlyMap<string, readonly string[]>;
    /**
     * Whether this play has already spent its one automatic re-arm (#3960).
     *
     * A lost engine is retired and offered back to the transport, which starts
     * a fresh session on the current default device. That start can itself be
     * lost — a headset that keeps dropping out re-dies on the rebuilt stream —
     * so the offer needs a guard, or the renderer cycles retire, re-arm, lose,
     * retire for as long as the device misbehaves.
     *
     * Set by `claimNativeSessionRearm`, cleared only by
     * `stopNativeLiveGraphSession`: a musician's stop or pause is what ends a
     * play, and the next play boots its own engine anyway. A start must never
     * clear it, because the re-armed start is itself a start — clearing there
     * would hand the guard back to the very session it exists to bound.
     */
    rearmClaimed: boolean;
    /**
     * The epoch names the play a claim belongs to. The stop bumps it, so a
     * claim taken before the stop can never start a session for the play after
     * it; a start bumps it too, so a recovery in flight for an earlier session
     * cannot re-arm or offer against the play that superseded it.
     */
    rearmEpoch: number;
    /**
     * How many `startNativeLiveGraphSession` calls have been requested and have
     * not settled yet.
     *
     * Counted from the call rather than from the moment its queued work runs,
     * because that window is exactly what a retire has to see: a retire
     * withholds its offer while any start is pending, since that start owns the
     * session the offer would re-arm. The epoch cannot say this on its own — a
     * start queued behind the retire has already bumped it, so the retire reads
     * an epoch that no longer moves and an orphan the start has not reached yet.
     */
    startsPending: number;
    /**
     * The strips this session is sounding, as it last claimed them.
     *
     * The same set `setNativeCarriedTracks` shuts the Web Audio gates for, held
     * here because the split has a second reader: the tick path has to know
     * whether a device's parameters are being stamped by the engine before it
     * writes them over IPC itself, and asking Web Audio's own gate state would
     * be asking the consumer of the split what the split is (#3568). Written
     * only by `claimCarriedStrips`, which is what keeps the two in step.
     */
    carriedStripIds: ReadonlySet<string>;
    /** The tail of this session's serialised command chain. */
    pending: Promise<unknown>;
};

export const nativeLiveGraphSession: NativeLiveGraphSession = {
    backend: null,
    orphanedBackend: null,
    audibleCarrier: false,
    // Shadowed until a session says otherwise. This is the initial state, not
    // the default a session starts in — the safe reading before any session has
    // spoken is the silent one, so a reader that runs first cannot conclude the
    // native engine is audible.
    monitorShadowed: true,
    rolling: false,
    loopRegion: null,
    loopEnabled: false,
    lastDeclineNotice: null,
    lastSilentPluginNotice: null,
    lastDeferredChainNotice: null,
    livenessWatch: null,
    nativeChainByStripId: new Map(),
    rearmClaimed: false,
    rearmEpoch: 0,
    startsPending: 0,
    carriedStripIds: new Set(),
    pending: Promise.resolve(),
};

/** Run `work` after everything already queued on the session, whatever it answered. */
export function queueOnNativeLiveGraphSession<TResult>(work: () => Promise<TResult>): Promise<TResult> {
    const next = nativeLiveGraphSession.pending.then(work, work);
    // Swallowed on the chain only: the returned promise still carries the
    // rejection to the caller, while the chain itself must stay usable so one
    // failed batch does not poison every command after it.
    nativeLiveGraphSession.pending = next.catch(() => undefined);
    return next;
}
