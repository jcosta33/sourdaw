/**
 * Shared control-rate slew for device-parameter automation — the single source
 * of truth for the first-order exponential smoothing the live apply path
 * (#746) runs on every automated device/MIDI-FX parameter before it reaches the
 * DSP, and that the offline compile path replicates so a bounce matches what you
 * monitor (finding AU-2, AUDIT-automation.md).
 *
 * ## The filter (state the math)
 *
 * Live `applyAutomation` runs, once per scheduler tick, a first-order IIR
 * one-pole low-pass on the target curve value:
 *
 *     y[n] = y[n-1] + α · (x[n] − y[n-1])          (equivalently
 *          = (1 − α) · y[n-1] + α · x[n])           α = {@link AUTOMATION_SLEW_ALPHA})
 *
 * seeded `y[0] = x[0]` (the first tick reads `prev ?? value`, so `smoothed =
 * value`). `x[n]` is the true curve value sampled at the tick grid; `y[n]` is
 * the value actually written to the parameter. The tick grid is the transport
 * scheduler grain — the shipping default `scheduleGrainMs = 10ms`
 * ({@link AUTOMATION_SLEW_TICK_SECONDS}), i.e. 100 Hz.
 *
 * Pole `(1 − α) = 0.6`; per-tick time constant `τ = −Δt / ln(1 − α) =
 * −0.01 / ln 0.6 ≈ 19.6 ms`; −3 dB corner `≈ 1 / (2π τ) ≈ 8.1 Hz`. This is a
 * genuine low-pass: fast automation moves are rounded off and lag the target by
 * ~τ, exactly the "monitor low-passes, bounce does not" divergence AU-2 names.
 *
 * The offline path replicates it **sample-accurately, not approximately**: it
 * samples the compiled curve `x(t)` at the same `Δt` grid and runs the identical
 * recurrence via {@link slewStep}. Because the offline compiled events already
 * carry the true curve at ≤`Δt` resolution, resampling them on the `Δt` grid
 * recovers the same `x[n]` the live path sees, so `y[n]` is identical
 * sample-for-sample.
 *
 * Gain/pan are deliberately **not** slewed here (nor live): they are backed by
 * real `AudioParam`s smoothed in-engine (`setTargetAtTime`) / scheduled a-rate,
 * so both live and offline bypass this filter for them (AU-2).
 *
 * RT-safe: pure, allocation-free, no locks/IO. Safe to call per scheduler tick.
 */

/** IIR smoothing coefficient of the live device-param slew (#746 / AU-2). */
export const AUTOMATION_SLEW_ALPHA = 0.4;

/**
 * The tick cadence the slew runs at, in seconds — the shipping default
 * transport scheduler grain (`scheduleGrainMs = 10ms`, 100 Hz). The offline
 * replica samples the curve at this grid so its discrete filter matches live.
 */
export const AUTOMATION_SLEW_TICK_SECONDS = 0.01;

/**
 * One step of the first-order slew: advance the smoothed value one tick toward
 * `target`. `y' = y + α·(target − y)`. Seed the first call with `previous ===
 * target` to hold (no glide from a stale value), matching the live seed.
 */
export function slewStep(previous: number, target: number, alpha: number = AUTOMATION_SLEW_ALPHA): number {
    return previous + (target - previous) * alpha;
}
