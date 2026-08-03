export const metronomeSchedulingState = {
    lastBeat: -1,
    firedClickTimes: new Map<number, number>(),
};

/** Float tolerance for treating two scheduled click times as the same instant. */
export const CLICK_TIME_EPSILON = 1e-4;

/**
 * How long a fired click's time is kept in the dedup map after it has played.
 *
 * A loop wrap is only detected once the playhead has already crossed loopEnd,
 * so by the time the wrap re-offers the seam as `loopStart` its click time lies
 * in the past — by the wrap overshoot, which the scheduler clamps to one
 * look-ahead window (0.1 s). Pruning on `firedTime < now` alone dropped the
 * entry a tick before the wrap could match it, and the seam clicked twice.
 * Retaining for the full clamp keeps the entry alive across the widest wrap the
 * scheduler can produce, and still bounds the map to a fraction of a second.
 */
export const CLICK_DEDUP_RETENTION_SECONDS = 0.1;
