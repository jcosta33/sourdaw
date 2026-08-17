/**
 * The timer seam every bounded wait in the shell takes.
 *
 * A handle that cancels itself, rather than an opaque id plus a matching
 * `clear` function. Two reasons, and both are about the deadlines this shell
 * depends on being real:
 *
 * - It removes the cast. `setTimeout` returns a platform-specific handle, so an
 *   injected `clearTimer(handle: unknown)` has to assert its way back to that
 *   type at every call site, and an assertion is exactly the thing that would
 *   still compile after the seam changed.
 * - It removes the pairing mistake. A handle can only be cancelled by the timer
 *   that created it, so a deadline cannot be armed by one clock and cancelled
 *   against another — which would leave a quit deadline running past the quit
 *   it was meant to bound.
 */

export type TimerHandle = {
    readonly cancel: () => void;
};

export type Timers = {
    readonly setTimer: (callback: () => void, ms: number) => TimerHandle;
};

/** The real clock. */
export const systemTimers: Timers = {
    setTimer: (callback, ms) => {
        const id = setTimeout(callback, ms);
        return { cancel: () => clearTimeout(id) };
    },
};
