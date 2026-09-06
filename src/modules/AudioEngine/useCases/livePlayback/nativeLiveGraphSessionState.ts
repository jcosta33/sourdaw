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
    nativeChainByStripId: new Map(),
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
