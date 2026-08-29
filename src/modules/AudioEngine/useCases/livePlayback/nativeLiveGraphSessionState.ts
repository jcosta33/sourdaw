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

export type NativeLiveGraphSession = {
    backend: AudioGraphBackend | null;
    /** The tail of this session's serialised command chain. */
    pending: Promise<unknown>;
};

export const nativeLiveGraphSession: NativeLiveGraphSession = {
    backend: null,
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
