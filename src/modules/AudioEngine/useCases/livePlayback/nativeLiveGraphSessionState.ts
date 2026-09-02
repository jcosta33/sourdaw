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
     * Two independent conditions, and both have to hold: the topology has to
     * schedule something (an engine with no clips has nothing to sound), and
     * the monitor has to be open (a shadowed engine writes true zeros at the
     * device however full its timeline is). Naming it for the conclusion
     * rather than for either half is deliberate — the earlier `carriesAudio`
     * asked only whether clips were scheduled, and the day a shadowed session
     * schedules a real programme that reading is wrong in the direction that
     * moves the playback cursor onto an engine nobody can hear.
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
    /** The tail of this session's serialised command chain. */
    pending: Promise<unknown>;
};

export const nativeLiveGraphSession: NativeLiveGraphSession = {
    backend: null,
    audibleCarrier: false,
    // Shadowed until a session says otherwise: the safe state is the silent
    // one, so a reader that runs before any session started cannot conclude
    // the native engine is audible.
    monitorShadowed: true,
    rolling: false,
    loopRegion: null,
    loopEnabled: false,
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
