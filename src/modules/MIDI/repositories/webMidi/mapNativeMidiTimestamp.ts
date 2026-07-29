import { MAX_CREDIBLE_INPUT_WAIT_SECONDS } from '../../models/InputTiming';

import { webMidiRuntime } from './state';

const MICROSECONDS_PER_MILLISECOND = 1000;
const MILLISECONDS_PER_SECOND = 1000;

type MapNativeMidiTimestampInput = {
    /**
     * midir's callback stamp, forwarded over IPC: microseconds since an origin
     * the crate documents only as "some unspecified point in the past". On
     * CoreMIDI it is host uptime; on other backends it may restart with the
     * port. Never comparable to `performance.now()` on its own.
     */
    timestampMicros: number | undefined;
    /** `performance.now()`, sampled as close to receipt as the IPC listener allows. */
    receivedAtMs: number;
};

/**
 * Express a native MIDI arrival instant on our own clock.
 *
 * The two clocks share no origin and nothing can measure the gap directly —
 * Rust cannot read `performance.now()`, and we never see the device clock
 * except through a message that has already been delayed. So the gap is
 * estimated from the messages themselves: every message gives
 * `received - native`, which is the true offset plus however long that
 * particular message waited. Delay is never negative, so the *smallest*
 * observed value is the best estimate available, and each new message can only
 * improve it.
 *
 * What that buys is the part that matters. Jitter — the variance between
 * messages, which is what smears a performance — is removed entirely, because
 * every stamp is derived from the same anchor. What remains is a constant
 * offset equal to the smallest scheduling delay ever seen on this port, which
 * is latency, not jitter, and it shrinks as the session goes on.
 *
 * Returns `undefined` when there is no usable native stamp, which leaves the
 * caller on the pre-existing "read the clock now" behaviour.
 */
export function mapNativeMidiTimestamp({
    timestampMicros,
    receivedAtMs,
}: MapNativeMidiTimestampInput): number | undefined {
    if (timestampMicros === undefined || !Number.isFinite(timestampMicros)) {
        return undefined;
    }

    const nativeMs = timestampMicros / MICROSECONDS_PER_MILLISECOND;
    const observedOffsetMs = receivedAtMs - nativeMs;
    const anchorMs = webMidiRuntime.nativeMidiTimeAnchorMs;

    if (anchorMs === null) {
        webMidiRuntime.nativeMidiTimeAnchorMs = observedOffsetMs;
        return receivedAtMs;
    }

    if (observedOffsetMs < anchorMs) {
        // This message waited less than any before it, so it sees the gap
        // between the clocks more clearly. Take the better estimate.
        webMidiRuntime.nativeMidiTimeAnchorMs = observedOffsetMs;
        return receivedAtMs;
    }

    const impliedWaitMs = observedOffsetMs - anchorMs;
    if (impliedWaitMs > MAX_CREDIBLE_INPUT_WAIT_SECONDS * MILLISECONDS_PER_SECOND) {
        // Beyond this the anchor is no longer describing the same relationship:
        // the clocks have drifted, or the device's epoch moved under us. Start
        // again here rather than return a stamp `resolveInputEventTime` would
        // refuse — being refused looks exactly like the fix not working.
        webMidiRuntime.nativeMidiTimeAnchorMs = observedOffsetMs;
        return receivedAtMs;
    }

    return anchorMs + nativeMs;
}
